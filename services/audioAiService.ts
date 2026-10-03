import { GoogleGenAI } from "@google/genai";

export interface TranscribeAudioParams {
  audioBase64OrUrl: string;
  mimeType?: string;
  apiKey?: string;
  provider?: "openai" | "gemini" | string;
  openaiApiKey?: string;
  geminiApiKey?: string;
}

export interface TextToSpeechParams {
  text: string;
  apiKey?: string;
  provider?: "openai" | "gemini" | string;
  voice?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
}

/**
 * Prepara o texto gerado pela IA para fala humana natural em português:
 * - Remove URLs (links devem ser enviados no balão de texto complementar, nunca soletrados no áudio)
 * - Converte quantias monetárias (ex: "R$ 7,49" -> "7 reais e 49 centavos")
 * - Converte marcadores e numerais ordinais para fala fluida
 * - Remove asteriscos de negrito, emojis e formatações markdown
 */
export function prepareTextForSpeech(text: string): string {
  if (!text || typeof text !== "string") return "";

  let speech = text
    // 1. Remove qualquer link ou menção a URLs no áudio
    .replace(/(?:para acessar|acesse|link:?|compre em|loja online:?|nossa webloja:?)?\s*https?:\/\/[^\s)]+/gi, "")
    // 2. Converte valores monetários R$ 14,50 para fala
    .replace(/R\$\s*(\d+)[,.](\d{2})/gi, "$1 reais e $2 centavos")
    .replace(/R\$\s*(\d+)/gi, "$1 reais")
    // 3. Converte listas numéricas com emojis para enumeração verbal
    .replace(/1️⃣/g, "Primeira opção: ")
    .replace(/2️⃣/g, "Segunda opção: ")
    .replace(/3️⃣/g, "Terceira opção: ")
    .replace(/4️⃣/g, "Quarta opção: ")
    // 4. Converte destaques
    .replace(/⭐\s*Mais econômica/gi, "(sendo a mais econômica)")
    // 5. Remove caracteres markdown de formatação
    .replace(/[*_~`#]/g, "")
    // 6. Remove emojis remanescentes
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    // 7. Limpa espaços e quebras de linha para pontuação pausada
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Limpa pontuações estranhas após remoção de links/emojis
  speech = speech
    .replace(/\.{2,}/g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .trim();

  // Se o texto ficou muito curto ou vazio
  if (!speech || speech.length < 3) {
    return "Olá! Seguem as opções disponíveis na nossa drogaria:";
  }

  return speech;
}

/**
 * Transcreve mensagem de áudio (PTT ou arquivo de áudio do WhatsApp)
 * Suporta OpenAI Whisper e Google Gemini multimodal.
 */
export async function transcribeAudio(params: TranscribeAudioParams): Promise<string | null> {
  const { audioBase64OrUrl } = params;
  if (!audioBase64OrUrl) return null;

  // 1. Extração do Base64 puro e do MimeType
  let base64Data = audioBase64OrUrl;
  let resolvedMime = params.mimeType || "audio/ogg";

  if (audioBase64OrUrl.startsWith("data:")) {
    const match = audioBase64OrUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      resolvedMime = match[1];
      base64Data = match[2];
    }
  } else if (audioBase64OrUrl.startsWith("http://") || audioBase64OrUrl.startsWith("https://")) {
    try {
      const fetchRes = await fetch(audioBase64OrUrl);
      if (fetchRes.ok) {
        const arrayBuf = await fetchRes.arrayBuffer();
        base64Data = Buffer.from(arrayBuf).toString("base64");
        const ct = fetchRes.headers.get("content-type");
        if (ct) resolvedMime = ct.split(";")[0].trim();
      }
    } catch (e: any) {
      console.warn("[AudioAiService] Erro ao baixar áudio da URL:", e.message);
    }
  }

  base64Data = base64Data.replace(/\s/g, "");
  if (!base64Data || base64Data.length < 50) {
    console.warn("[AudioAiService] Buffer de áudio vazio ou muito pequeno para transcrição.");
    return null;
  }

  // 2. Determina chaves disponíveis
  const openAiKey = params.openaiApiKey || (params.apiKey?.startsWith("sk-") ? params.apiKey : undefined) || process.env.OPENAI_API_KEY;
  const geminiKey = params.geminiApiKey || (!params.apiKey?.startsWith("sk-") ? params.apiKey : undefined) || process.env.GEMINI_API_KEY;

  // 3. Tenta primeiro OpenAI Whisper se a chave OpenAI estiver configurada
  if (openAiKey) {
    try {
      console.log(`[AudioAiService] 🎙️ Enviando áudio (${resolvedMime}, ~${base64Data.length} chars base64) para transcrição via OpenAI Whisper...`);
      const audioBuffer = Buffer.from(base64Data, "base64");
      
      const formData = new FormData();
      const ext = resolvedMime.includes("mp3") ? "mp3" : resolvedMime.includes("wav") ? "wav" : resolvedMime.includes("m4a") ? "m4a" : "ogg";
      const blob = new Blob([audioBuffer], { type: resolvedMime });
      formData.append("file", blob, `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "pt");

      const transRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openAiKey.trim()}`
        },
        body: formData
      });

      if (transRes.ok) {
        const transJson: any = await transRes.json();
        const transcribedText = (transJson.text || "").trim();
        if (transcribedText) {
          console.log(`[AudioAiService] ✅ Transcrição Whisper concluída com sucesso: "${transcribedText}"`);
          return transcribedText;
        }
      } else {
        const errText = await transRes.text();
        console.warn(`[AudioAiService] Whisper retornou HTTP ${transRes.status}:`, errText);
      }
    } catch (whisperErr: any) {
      console.warn("[AudioAiService] Falha na transcrição OpenAI Whisper:", whisperErr.message);
    }
  }

  // 4. Se Whisper falhou ou não tem chave OpenAI, tenta Google Gemini
  if (geminiKey) {
    try {
      console.log(`[AudioAiService] 🎙️ Enviando áudio (${resolvedMime}) para transcrição via Google Gemini...`);
      const ai = new GoogleGenAI({ apiKey: geminiKey.trim() });
      const geminiMime = resolvedMime.includes("ogg") ? "audio/ogg" : resolvedMime.includes("mp3") ? "audio/mp3" : resolvedMime.includes("wav") ? "audio/wav" : "audio/ogg";

      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: geminiMime,
              data: base64Data
            }
          },
          {
            text: "Transcreva exatamente a fala do cliente neste áudio em português do Brasil. Retorne APENAS o texto falado, sem comentários, sem pontuações artificiais e sem aspas."
          }
        ]
      });

      const geminiText = (res.text || "").trim();
      if (geminiText) {
        console.log(`[AudioAiService] ✅ Transcrição Gemini concluída com sucesso: "${geminiText}"`);
        return geminiText;
      }
    } catch (geminiErr: any) {
      console.warn("[AudioAiService] Falha na transcrição Gemini:", geminiErr.message);
    }
  }

  return null;
}

/**
 * Converte texto em áudio sintetizado e humanizado (Text-to-Speech)
 * Suporta OpenAI TTS (model: tts-1, voz: alloy/shimmer) e Gemini TTS (gemini-3.8-flash-lite-tts).
 * Retorna uma Data URI com áudio em base64 pronta para envio no WhatsApp.
 */
export async function generateTextToSpeech(params: TextToSpeechParams): Promise<{ audioBase64: string; mimeType: string } | null> {
  const { text } = params;
  if (!text || text.trim().length === 0) return null;

  const speechText = prepareTextForSpeech(text);
  if (!speechText) return null;

  const openAiKey = params.openaiApiKey || (params.apiKey?.startsWith("sk-") ? params.apiKey : undefined) || process.env.OPENAI_API_KEY;
  const geminiKey = params.geminiApiKey || (!params.apiKey?.startsWith("sk-") ? params.apiKey : undefined) || process.env.GEMINI_API_KEY;

  // 1. Tenta OpenAI TTS
  if (openAiKey) {
    try {
      console.log(`[AudioAiService] 🔊 Gerando áudio humanizado via OpenAI TTS (voz: ${params.voice || 'alloy'})...`);
      const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openAiKey.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "tts-1",
          input: speechText,
          voice: params.voice || "alloy",
          response_format: "mp3"
        })
      });

      if (ttsRes.ok) {
        const arrayBuf = await ttsRes.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuf).toString("base64");
        const fullDataUri = `data:audio/mp3;base64,${base64Audio}`;
        console.log(`[AudioAiService] ✅ OpenAI TTS gerou áudio com sucesso (~${fullDataUri.length} chars Data URI)!`);
        return {
          audioBase64: fullDataUri,
          mimeType: "audio/mp3"
        };
      } else {
        const errText = await ttsRes.text();
        console.warn(`[AudioAiService] OpenAI TTS retornou HTTP ${ttsRes.status}:`, errText);
      }
    } catch (ttsErr: any) {
      console.warn("[AudioAiService] Falha no OpenAI TTS:", ttsErr.message);
    }
  }

  // 2. Tenta Google Gemini TTS como alternativa
  if (geminiKey) {
    try {
      console.log(`[AudioAiService] 🔊 Gerando áudio humanizado via Gemini TTS (gemini-3.8-flash-lite-tts)...`);
      const ai = new GoogleGenAI({ apiKey: geminiKey.trim() });
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [{ text: speechText }]
          }
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" }
            }
          }
        }
      });

      const base64Wav = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Wav) {
        const fullDataUri = `data:audio/wav;base64,${base64Wav}`;
        console.log(`[AudioAiService] ✅ Gemini TTS gerou áudio WAV com sucesso (~${fullDataUri.length} chars Data URI)!`);
        return {
          audioBase64: fullDataUri,
          mimeType: "audio/wav"
        };
      }
    } catch (geminiTtsErr: any) {
      console.warn("[AudioAiService] Falha no Gemini TTS:", geminiTtsErr.message);
    }
  }

  return null;
}
