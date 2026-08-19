import { supabase } from './supabase.js';
import { Product } from '../types';
import { GoogleGenAI } from '@google/genai';
import { retryRequest } from './storage.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const sanitizeProductName = (name: string) => {
    return name.replace(/[^\w\sÀ-ÿ]/gi, ' ').replace(/\s+/g, ' ').trim();
};

const validateImageUrl = async (url: string): Promise<boolean> => {
    try {
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('placeholder') || lowerUrl.includes('sem-foto') || lowerUrl.includes('no-image') || lowerUrl.includes('default')) {
            return false;
        }

        // Bypass validation for known CDNs that might block HEAD requests or proxies
        if (lowerUrl.includes('cdn-cosmos.bluesoft.com.br')) {
            return true;
        }

        const checkResponse = async (res: Response, isTrusted: boolean = false) => {
            if (!res.ok) return false;
            const ct = res.headers.get('content-type');
            if (ct && !ct.startsWith('image/')) return false;
            
            // If it's a trusted domain, we can be more lenient with content-length
            // as some CDNs don't return it on HEAD requests.
            const cl = res.headers.get('content-length');
            if (cl && parseInt(cl) < 3000) return false; // Still avoid tiny icons
            
            return true;
        };

        const TRUSTED_DOMAINS = ['drogasil', 'paguemenos', 'panvel', 'drogaraia', 'amazon', 'mercadolivre', 'ultrafarma', 'venancio', 'drogariasaopaulo', 'onofre', 'saojoaofarmacias', 'farmaciasapp', 'farmaciasdescontao', 'hiperfarmac', 'cdn-cosmos.bluesoft.com.br'];
        const isTrusted = TRUSTED_DOMAINS.some(domain => lowerUrl.includes(domain));

        // 1. Try direct fetch first (HEAD)
        try {
            const directRes = await fetch(url, { method: 'HEAD' });
            if (await checkResponse(directRes, isTrusted)) return true;
        } catch (e) { /* CORS or network error */ }

        // Proxies to try
        const proxies = [
            `https://wsrv.nl/?url=${encodeURIComponent(url)}&default=404`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://corsproxy.io/?${encodeURIComponent(url)}`
        ];

        for (const proxyUrl of proxies) {
            try {
                // Try HEAD first
                const headRes = await fetch(proxyUrl, { method: 'HEAD', headers: { 'User-Agent': getRandomUserAgent() } });
                if (await checkResponse(headRes, isTrusted)) return true;
                
                // If HEAD fails, try GET with Range to save bandwidth
                const getRes = await fetch(proxyUrl, { method: 'GET', headers: { 'Range': 'bytes=0-2048', 'User-Agent': getRandomUserAgent() } });
                if (await checkResponse(getRes, isTrusted)) return true;
            } catch (e) {
                continue;
            }
        }

        return false;
    } catch (e) {
        return false;
    }
};

export const consolidateProductImage = async (product: Product): Promise<string | null> => {
    const candidates = [product.image, product.image_url_2, product.image_url_3].filter(u => u && u.startsWith('http'));
    
    for (const url of candidates) {
        if (await validateImageUrl(url!)) {
            return url!;
        }
    }
    return null;
};
