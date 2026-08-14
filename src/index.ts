#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/StreamableHTTP.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'node:http';

const BASE_URL = (process.env.BUMI_BASE_URL || 'https://bumi.digital').replace(/\/+$/, '');
// API key global (mode stdio). Mode HTTP: key diambil dari header Authorization tiap request.
const ENV_API_KEY = process.env.BUMI_API_KEY || '';
const PORT = Number(process.env.PORT || 3100);

const VALID_TYPES = ['image', 'video', 'audio', 'upscale-image', 'upscale-video'] as const;

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

async function apiRequest(
  apiKey: string,
  method: 'GET' | 'POST',
  pathName: string,
  options: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${pathName}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: string }).error || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(`Bumi API error (${res.status}): ${msg}`);
  }
  return data;
}

function generateBody(args: {
  model_id: string;
  parameters?: Record<string, unknown>;
  webhook_url?: string;
}) {
  return {
    model_id: args.model_id,
    parameters: args.parameters ?? {},
    ...(args.webhook_url ? { webhook_url: args.webhook_url } : {}),
  };
}

const generateInputSchema = {
  type: 'object' as const,
  properties: {
    model_id: {
      type: 'string',
      description:
        'ID model (lihat tool list_models / get_models_pricing untuk daftar model_id dan input_schema parameternya)',
    },
    parameters: {
      type: 'object',
      description:
        'Parameter sesuai input_schema model, mis. { prompt, aspect_ratio }. File input bisa berupa URL http(s), data URI base64, atau path /api/tmp/...',
      additionalProperties: true,
    },
    webhook_url: {
      type: 'string',
      description: 'URL webhook opsional yang dipanggil saat status completed/failed',
    },
  },
  required: ['model_id'],
};

const tools = [
  {
    name: 'list_models',
    description:
      'Daftar model AI yang tersedia di Bumi Digital (ringkas). Untuk detail parameter & harga gunakan get_models_pricing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: VALID_TYPES,
          description: 'Tipe model',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_models_pricing',
    description:
      'Daftar model beserta harga kredit dan input_schema lengkap (parameter yang didukung tiap model). Tanpa type = semua model.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: VALID_TYPES, description: 'Filter tipe model (opsional)' },
      },
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate gambar. Response bisa status "completed" (langsung ada image_url) atau "processing" (poll dengan get_generation_status). Kredit dipotong di awal, refund otomatis bila gagal.',
    inputSchema: generateInputSchema,
  },
  {
    name: 'generate_video',
    description:
      'Generate video (text-to-video, image-to-video, motion control, avatar, lipsync). Response bisa "completed" atau "processing" (poll dengan get_generation_status).',
    inputSchema: generateInputSchema,
  },
  {
    name: 'generate_audio',
    description:
      'Generate audio (music, speech/TTS, lipsync). Parameter wajib mengikuti input_schema model. Response bisa "completed" atau "processing".',
    inputSchema: generateInputSchema,
  },
  {
    name: 'upscale_image',
    description: 'Upscale gambar ke resolusi lebih tinggi.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model_id: { type: 'string', description: 'ID model upscale-image' },
        image_url: {
          type: 'string',
          description: 'URL http(s) publik gambar sumber (upload dulu dengan upload_file bila belum publik)',
        },
        parameters: {
          type: 'object',
          description: 'Parameter tambahan sesuai input_schema model (mis. scale)',
          additionalProperties: true,
        },
      },
      required: ['model_id', 'image_url'],
    },
  },
  {
    name: 'upscale_video',
    description: 'Upscale video ke resolusi lebih tinggi.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model_id: { type: 'string', description: 'ID model upscale-video' },
        video_url: {
          type: 'string',
          description: 'URL http(s) publik video sumber (upload dulu dengan upload_file bila belum publik)',
        },
        parameters: {
          type: 'object',
          description: 'Parameter tambahan sesuai input_schema model',
          additionalProperties: true,
        },
      },
      required: ['model_id', 'video_url'],
    },
  },
  {
    name: 'check_credits',
    description: 'Cek saldo kredit akun Bumi Digital saat ini.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_generation_status',
    description:
      'Cek status & hasil sebuah generation (untuk polling hasil async). Status: processing | completed | failed. Hasil ada di field resultUrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        generation_id: { type: 'string', description: 'ID generation dari response generate' },
      },
      required: ['generation_id'],
    },
  },
  {
    name: 'list_generations',
    description: 'Riwayat generation dengan filter dan pagination.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'integer', description: 'Halaman (default 1)', minimum: 1 },
        limit: { type: 'integer', description: 'Jumlah per halaman (default 20, maks 100)', minimum: 1, maximum: 100 },
        type: { type: 'string', enum: VALID_TYPES, description: 'Filter tipe' },
        status: {
          type: 'string',
          enum: ['processing', 'completed', 'failed'],
          description: 'Filter status',
        },
        q: { type: 'string', description: 'Cari di prompt/model' },
        from: { type: 'string', description: 'Tanggal mulai (ISO 8601)' },
        to: { type: 'string', description: 'Tanggal akhir (ISO 8601)' },
      },
    },
  },
  {
    name: 'upload_file',
    description:
      'Upload file (gambar/video/audio) ke storage Bumi Digital, mengembalikan file_url yang bisa dipakai sebagai parameter input generate/upscale. Sumber bisa URL publik (source_url) atau base64 (file_base64 + file_name). Batas: image 20MB, video 100MB, audio 50MB.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source_url: {
          type: 'string',
          description: 'URL http(s) publik file yang akan di-upload ulang ke storage Bumi',
        },
        file_base64: {
          type: 'string',
          description: 'Konten file dalam base64 (alternatif dari source_url)',
        },
        file_name: {
          type: 'string',
          description: 'Nama file beserta ekstensi (wajib bila memakai file_base64), mis. foto.png',
        },
      },
    },
  },
];

async function uploadToBumi(
  apiKey: string,
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<unknown> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), fileName);

  const res = await fetch(`${BASE_URL}/api/v1/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(`Bumi API error (${res.status}): ${data.error || res.statusText}`);
  }
  return data;
}

async function handleCall(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'list_models':
      return apiRequest(apiKey, 'GET', '/api/v1/models', {
        query: { type: args.type as string },
      });

    case 'get_models_pricing':
      return apiRequest(apiKey, 'GET', '/api/v1/models/pricing', {
        query: { type: args.type as string | undefined },
      });

    case 'generate_image':
      return apiRequest(apiKey, 'POST', '/api/v1/image/generate', {
        body: generateBody(
          args as { model_id: string; parameters?: Record<string, unknown>; webhook_url?: string },
        ),
      });

    case 'generate_video':
      return apiRequest(apiKey, 'POST', '/api/v1/video/generate', {
        body: generateBody(
          args as { model_id: string; parameters?: Record<string, unknown>; webhook_url?: string },
        ),
      });

    case 'generate_audio':
      return apiRequest(apiKey, 'POST', '/api/v1/audio/generate', {
        body: generateBody(
          args as { model_id: string; parameters?: Record<string, unknown>; webhook_url?: string },
        ),
      });

    case 'upscale_image':
      return apiRequest(apiKey, 'POST', '/api/v1/upscale/image', {
        body: {
          model_id: args.model_id,
          parameters: {
            ...((args.parameters as Record<string, unknown>) ?? {}),
            image: args.image_url,
          },
        },
      });

    case 'upscale_video':
      return apiRequest(apiKey, 'POST', '/api/v1/upscale/video', {
        body: {
          model_id: args.model_id,
          parameters: {
            ...((args.parameters as Record<string, unknown>) ?? {}),
            video: args.video_url,
          },
        },
      });

    case 'check_credits':
      return apiRequest(apiKey, 'GET', '/api/v1/credits');

    case 'get_generation_status':
      return apiRequest(
        apiKey,
        'GET',
        `/api/v1/generation/${encodeURIComponent(args.generation_id as string)}`,
      );

    case 'list_generations':
      return apiRequest(apiKey, 'GET', '/api/v1/generations', {
        query: {
          page: args.page !== undefined ? String(args.page) : undefined,
          limit: args.limit !== undefined ? String(args.limit) : undefined,
          type: args.type as string | undefined,
          status: args.status as string | undefined,
          q: args.q as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
        },
      });

    case 'upload_file': {
      if (!apiKey) {
        throw new Error('API key tidak tersedia (set BUMI_API_KEY atau header Authorization).');
      }
      const sourceUrl = args.source_url as string | undefined;
      const fileBase64 = args.file_base64 as string | undefined;

      if (sourceUrl) {
        const upstream = await fetch(sourceUrl);
        if (!upstream.ok) {
          throw new Error(`Gagal mengambil source_url (HTTP ${upstream.status})`);
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());
        const urlPath = new URL(sourceUrl).pathname;
        const ext = (urlPath.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
        const mime =
          upstream.headers.get('content-type')?.split(';')[0] ||
          MIME_BY_EXT[ext] ||
          'application/octet-stream';
        const fileName = urlPath.split('/').pop() || `file${ext || ''}`;
        return uploadToBumi(apiKey, buffer, mime, fileName);
      }

      if (fileBase64) {
        const fileName = args.file_name as string | undefined;
        if (!fileName) {
          throw new Error('file_name wajib diisi bila memakai file_base64.');
        }
        const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime) {
          throw new Error(`Ekstensi ${ext || '(tanpa ekstensi)'} tidak didukung.`);
        }
        return uploadToBumi(apiKey, Buffer.from(fileBase64, 'base64'), mime, fileName);
      }

      throw new Error('Isi salah satu: source_url atau file_base64 (+ file_name).');
    }

    default:
      throw new Error(`Tool tidak dikenal: ${name}`);
  }
}

function createMcpServer(getApiKey: () => string): Server {
  const server = new Server(
    { name: 'bumi-digital-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleCall(
        getApiKey(),
        request.params.name,
        (request.params.arguments as Record<string, unknown>) ?? {},
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          { type: 'text', text: err instanceof Error ? err.message : String(err) },
        ],
        isError: true,
      };
    }
  });

  return server;
}

function extractApiKey(req: http.IncomingMessage): string {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token || ENV_API_KEY;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function runHttp() {
  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'bumi-digital-mcp' }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Gunakan endpoint /mcp' }));
      return;
    }

    try {
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const apiKey = extractApiKey(req);

      // Stateless: server + transport baru per request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = createMcpServer(() => apiKey);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Internal server error',
          }),
        );
      }
    }
  });

  httpServer.listen(PORT, () => {
    console.error(`bumi-digital-mcp HTTP berjalan di http://0.0.0.0:${PORT}/mcp (API: ${BASE_URL})`);
  });
}

async function runStdio() {
  const server = createMcpServer(() => ENV_API_KEY);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`bumi-digital-mcp stdio berjalan (API: ${BASE_URL})`);
}

const mode = process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http'
  ? 'http'
  : 'stdio';

(mode === 'http' ? runHttp() : runStdio()).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
