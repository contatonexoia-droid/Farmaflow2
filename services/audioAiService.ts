import OpenAI, { toFile } from 'openai';

export interface TranscribeAudioParams {
  audioBase64OrUrl: string;
  mimeType?: string;
  apiKey?: string;
  openaiApiKey?: string;
  tenantConfig?: any;
  tenant?: any;
  provider?: string;
  geminiApiKey?: string;
}

export interface TextToSpeechParams {
  text: string;
  apiKey?: string;
  openaiApiKey?: string;
  voice?: 'alloy' | 'shimmer' | 'echo' | 'fable' | 'onyx' | 'nova' | string;
  tenantConfig?: any;
  tenant?: any;
  provider?: string;
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
 * Resolve a chave da OpenAI seguindo a ordem oficial:
 * 1. Primeiro verificando as configurações do tenant no Supabase (settings.openai_api_key ou openai_api_key da drogaria)
 * 2. Fallback da variável de ambiente: process.env.OPENAI_API_KEY
 */
export function resolveOpenAiApiKey(params?: {
  apiKey?: string;
  openaiApiKey?: string;
  tenantConfig?: any;
  tenant?: any;
}): string | undefined {
  const cfg = params?.tenantConfig || params?.tenant?.ai_agent_config || params?.tenant?.ai_agent_settings || params?.tenant?.ai_config || {};
  const settings = params?.tenant?.settings || {};

  const key = 
    params?.openaiApiKey ||
    settings?.openai_api_key ||
    params?.tenant?.openai_api_key ||
    cfg?.openai_api_key ||
    (params?.apiKey && params.apiKey.startsWith('sk-') ? params.apiKey : undefined) ||
    (cfg?.apiKey && cfg.apiKey.startsWith('sk-') ? cfg.apiKey : undefined) ||
    (cfg?.provider === 'openai' ? (cfg.apiKey || cfg.api_key) : undefined) ||
    params?.apiKey ||
    process.env.OPENAI_API_KEY;

  return key ? String(key).trim() : undefined;
}

/**
 * Inicializa a SDK oficial da OpenAI com a chave da drogaria ou ambiente
 */
export function getOpenAIClient(params?: {
  apiKey?: string;
  openaiApiKey?: string;
  tenantConfig?: any;
  tenant?: any;
}): OpenAI {
  const resolvedApiKey = resolveOpenAiApiKey(params);
  if (!resolvedApiKey) {
    throw new Error("Chave da OpenAI não configurada (OPENAI_API_KEY).");
  }
  return new OpenAI({ apiKey: resolvedApiKey });
}

/**
 * Transcreve mensagem de áudio (PTT ou arquivo de áudio do WhatsApp)
 * Operando 100% via OPENAI WHISPER (STT)
 */
export async function transcribeAudio(params: TranscribeAudioParams): Promise<string | null> {
  const { audioBase64OrUrl } = params;
  if (!audioBase64OrUrl) return null;

  // a) Validação e Log da API Key
  const resolvedApiKey = resolveOpenAiApiKey(params);
  console.log('[AUDIO_DEBUG] OpenAI API Key presente?', Boolean(resolvedApiKey), 'Tam:', resolvedApiKey?.length);

  if (!resolvedApiKey) {
    console.error('[AUDIO_DEBUG] Nenhuma API Key encontrada para transcrição.');
    return null;
  }

  // 1. Extração do Base64 puro se for URL remota
  let base64Data = audioBase64OrUrl;
  if (audioBase64OrUrl.startsWith("http://") || audioBase64OrUrl.startsWith("https://")) {
    try {
      console.log('[AUDIO_DEBUG] Baixando áudio de URL remota:', audioBase64OrUrl.slice(0, 60));
      const fetchRes = await fetch(audioBase64OrUrl);
      if (fetchRes.ok) {
        const arrayBuf = await fetchRes.arrayBuffer();
        base64Data = Buffer.from(arrayBuf).toString("base64");
      } else {
        console.error('[AUDIO_DEBUG] Falha ao baixar áudio da URL:', fetchRes.status, await fetchRes.text());
      }
    } catch (e: any) {
      console.warn("[AUDIO_DEBUG] Erro ao baixar áudio da URL:", e.message);
    }
  }

  // b) Sanitização Rigorosa do Base64
  let rawBase64 = base64Data;
  if (rawBase64.includes(',')) {
    rawBase64 = rawBase64.split(',')[1];
  }
  rawBase64 = rawBase64.replace(/\s/g, '');
  const audioBuffer = Buffer.from(rawBase64, 'base64');
  console.log('[AUDIO_DEBUG] Tamanho do buffer de áudio decodificado (bytes):', audioBuffer.length);

  if (!audioBuffer || audioBuffer.length < 50) {
    console.warn("[AUDIO_DEBUG] Buffer de áudio vazio ou muito pequeno para transcrição:", audioBuffer.length);
    return null;
  }

  // c) Detecção de Formato e Envio Seguro para o Whisper
  try {
    const openai = new OpenAI({ apiKey: resolvedApiKey });

    // Se começar com ID3 ou 0xFF 0xFB/0xF3 é MP3, caso contrário tratar como OGG
    const isMp3 = audioBuffer.length > 3 && (
      (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33) ||
      (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0)
    );
    const fileName = isMp3 ? 'audio.mp3' : 'audio.ogg';
    const mimeType = isMp3 ? 'audio/mpeg' : 'audio/ogg';

    console.log('[AUDIO_DEBUG] Formato detectado:', fileName, mimeType);
    const audioFile = await toFile(audioBuffer, fileName, { type: mimeType });

    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt',
    });

    const transcribedText = transcriptionResponse.text?.trim();
    console.log('[AUDIO_DEBUG] Transcrição Whisper com sucesso:', transcribedText);
    return transcribedText || null;
  } catch (error: any) {
    // d) Log do Erro Real no Catch
    console.error('[AUDIO_DEBUG] Erro detalhado no transcribeAudio:', error?.response?.data || error?.message || error);
    return null;
  }
}

/**
 * Converte a resposta do agente em áudio nativo via OPENAI TTS (modelo: tts-1, voz: alloy/shimmer)
 * Retorna uma Data URI com áudio em base64 pronta para envio no WhatsApp.
 */
export async function generateTextToSpeech(params: TextToSpeechParams): Promise<{ audioBase64: string; mimeType: string } | null> {
  const { text } = params;
  if (!text || text.trim().length === 0) return null;

  const speechText = prepareTextForSpeech(text);
  if (!speechText) return null;

  try {
    const resolvedApiKey = resolveOpenAiApiKey(params);
    if (!resolvedApiKey) {
      console.error("[AudioAiService] Nenhuma chave OpenAI configurada para o TTS.");
      return null;
    }

    const openai = new OpenAI({ apiKey: resolvedApiKey });
    const voiceToUse = (params.voice as any) || "alloy";

    console.log(`[AudioAiService] 🔊 Gerando áudio humanizado via OpenAI TTS (model: tts-1, voz: ${voiceToUse})...`);
    const mp3Response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voiceToUse,
      input: speechText,
    });

    const audioArrayBuffer = await mp3Response.arrayBuffer();
    const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');
    const fullDataUri = `data:audio/mp3;base64,${base64Audio}`;

    console.log(`[AudioAiService] ✅ OpenAI TTS gerou áudio com sucesso (~${fullDataUri.length} chars Data URI)!`);
    return {
      audioBase64: fullDataUri,
      mimeType: "audio/mp3"
    };
  } catch (err: any) {
    console.error("[AudioAiService] Falha no OpenAI TTS:", err?.message || err);
    return null;
  }
}
