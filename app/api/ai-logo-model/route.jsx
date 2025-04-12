export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { AILogoPrompt } from "@/configs/AiModel";
import { db } from "@/configs/FirebaseConfig";
import axios from "axios";
import { doc, setDoc } from "firebase/firestore";
import { NextResponse } from "next/server";

// Fallback Logo Generator (Simple SVG)
const generateFallbackLogo = (text) => {
  const svg = `
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f0f0f0"/>
      <text x="50%" y="50%" font-family="Arial" font-size="20" fill="#333" text-anchor="middle" dominant-baseline="middle">
        ${text.substring(0, 10)}
      </text>
    </svg>
  `;
  return Buffer.from(svg).toString('base64');
};

// Helper function to call Hugging Face API with error handling
const callHuggingFaceAPI = async (model, prompt, timeout = 40000) => {
  try {
    const response = await axios.post(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      prompt,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout,
      }
    );
    const buffer = Buffer.from(response.data, "binary");
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn(`HuggingFace API (${model}) failed:`, error.message);
    return null; // Return null if API fails
  }
};

export async function POST(req) {
  const { prompt, email, title, desc } = await req.json();

  try {
    // Generate AI Prompt
    const AiPromptResult = await AILogoPrompt.sendMessage(prompt);
    const responseText = await AiPromptResult.response.text();
    const parsedResponse = JSON.parse(responseText);
    const AiPrompt = parsedResponse.prompt;

    // Try Primary Model (FLUX.1-dev)
    let base64ImageWithMime = await callHuggingFaceAPI(
      "black-forest-labs/FLUX.1-dev",
      AiPrompt,
      1000000 // 1000s timeout
    );

    // If primary fails, try Secondary Model (e.g., stabilityai/stable-diffusion-xl-base-1.0)
    if (!base64ImageWithMime) {
      console.log("Trying secondary Hugging Face model...");
      base64ImageWithMime = await callHuggingFaceAPI(
        "stabilityai/stable-diffusion-xl-base-1.0", // Free alternative
        { inputs: AiPrompt },
        60000 // 60s timeout for secondary
      );
    }

    // If both APIs fail, use SVG fallback
    if (!base64ImageWithMime) {
      console.log("Both APIs failed, using SVG fallback");
      const fallbackImage = generateFallbackLogo(title || prompt);
      base64ImageWithMime = `data:image/svg+xml;base64,${fallbackImage}`;
    }

    // Save to Firestore
    await setDoc(doc(db, "users", email, "logos", Date.now().toString()), {
      image: base64ImageWithMime,
      title: title,
      desc: desc,
      createdAt: new Date(),
    });

    // Return the generated image (API or fallback)
    return NextResponse.json({ image: base64ImageWithMime });
  } catch (error) {
    console.error("Error in /api/ai-logo-model:", error);
    // Ultimate fallback if everything crashes
    const fallbackImage = generateFallbackLogo(title || prompt);
    return NextResponse.json(
      {
        error: "Primary generation failed. Using fallback logo.",
        image: `data:image/svg+xml;base64,${fallbackImage}`,
      },
      { status: 200 }
    );
  }
}