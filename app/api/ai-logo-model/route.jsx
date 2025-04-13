export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { AILogoPrompt } from "@/configs/AiModel";
import { db } from "@/configs/FirebaseConfig";
import axios from "axios";
import { doc, setDoc } from "firebase/firestore";
import { NextResponse } from "next/server";

// Faster free models (under 10s generation time)
const FAST_MODELS = [
  'prompthero/openjourney-v4',          // ~3-5s (best for logos)
  'stabilityai/stable-diffusion-xl-base-1.0', // ~5-8s (high quality)
  'runwayml/stable-diffusion-v1-5',     // ~4-7s (balanced)
  'wavymulder/Analog-Diffusion'         // ~3-6s (vintage style)
];

// Fallback Logo Generator
const generateFallbackLogo = (text) => {
  const svg = `
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f0f0f0"/>
      <text x="50%" y="50%" font-family="Arial" font-size="20" fill="#333" text-anchor="middle">
        ${text.substring(0, 10)}
      </text>
    </svg>
  `;
  return Buffer.from(svg).toString('base64');
};

const callHuggingFaceAPI = async (model, prompt, timeout = 8000) => {
  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      { inputs: prompt },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer",
        timeout
      }
    );
    return `data:image/png;base64,${Buffer.from(response.data).toString('base64')}`;
  } catch (error) {
    console.warn(`Failed on ${model}:`, error.message);
    return null;
  }
};

export async function POST(req) {
  const { prompt, email, title, desc } = await req.json();

  try {
    // Generate optimized prompt
    const AiPromptResult = await AILogoPrompt.sendMessage(prompt);
    const parsedResponse = JSON.parse(await AiPromptResult.response.text());
    const aiPrompt = parsedResponse.prompt;

    // Try models in order of speed
    let generatedImage;
    for (const model of FAST_MODELS) {
      generatedImage = await callHuggingFaceAPI(model, aiPrompt, 8000);
      if (generatedImage) break;
    }

    // Fallback if all models fail
    if (!generatedImage) {
      console.log("All models failed, using SVG fallback");
      generatedImage = `data:image/svg+xml;base64,${generateFallbackLogo(title || prompt)}`;
    }

    // Save to Firestore
    await setDoc(doc(db, "users", email, "logos", Date.now().toString()), {
      image: generatedImage,
      title,
      desc,
      createdAt: new Date()
    });

    return NextResponse.json({ image: generatedImage });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      {
        error: "Generation failed",
        image: `data:image/svg+xml;base64,${generateFallbackLogo(title || prompt)}`
      },
      { status: 200 }
    );
  }
}