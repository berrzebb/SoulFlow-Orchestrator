import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextBuilder } from '@src/agent/context.ts';

async function make_ws() { return mkdtemp(join(tmpdir(), 'ctx-svc-')); }

describe('ContextBuilder — 미커버 경로', () => {
  it('reference_store 있고 결과 있음 → reference 섹션 포함', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const ref_store = {
        sync: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([{ doc_path: 'README.md', heading: 'Intro', content: 'project overview' }]),
      };
      builder.set_reference_store(ref_store as any);
      const messages = await builder.build_messages([], 'tell me about the project');
      const all = messages.map((m) => String(m.content)).join(' ');
      expect(all).toContain('Reference Documents');
      expect(all).toContain('project overview');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('reference_store 결과 없음 → reference 섹션 없음', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_reference_store({ sync: vi.fn().mockResolvedValue(undefined), search: vi.fn().mockResolvedValue([]) } as any);
      const messages = await builder.build_messages([], 'no match');
      const all = messages.map((m) => String(m.content)).join(' ');
      expect(all).not.toContain('Reference Documents');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('reference_store.sync 에러 → 조용히 무시', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_reference_store({ sync: vi.fn().mockRejectedValue(new Error('sync err')), search: vi.fn() } as any);
      const messages = await builder.build_messages([], 'test');
      expect(messages.length).toBeGreaterThan(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('_build_user_content: media 없으면 string 반환', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._build_user_content('hello', [])).toBe('hello');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('_build_user_content: http URL → input_media 타입', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._build_user_content('text', ['https://example.com/img.png']) as any[];
      expect(result[0].type).toBe('text');
      expect(result[1].type).toBe('input_media');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('oauth connected → OAuth 섹션 포함', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_oauth_summary_provider(async () => [
        { instance_id: 'svc-1', service_type: 'google', label: 'Google Drive', scopes: ['read'], connected: true },
      ]);
      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain('OAuth Integrations');
      expect(prompt).toContain('Google Drive');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('oauth connected=false → OAuth 섹션 없음', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_oauth_summary_provider(async () => [
        { instance_id: 'svc-1', service_type: 'google', label: 'Google', scopes: [], connected: false },
      ]);
      const prompt = await builder.build_system_prompt();
      expect(prompt).not.toContain('OAuth Integrations');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('oauth_summary_provider 에러 → 조용히 무시', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_oauth_summary_provider(async () => { throw new Error('oauth error'); });
      const prompt = await builder.build_system_prompt();
      expect(typeof prompt).toBe('string');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('_to_image_data_uri_if_local: data: URI → 그대로 반환', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const uri = 'data:image/png;base64,abc123';
      expect((builder as any)._to_image_data_uri_if_local(uri)).toBe(uri);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('_to_image_data_uri_if_local: https URL → null', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._to_image_data_uri_if_local('https://example.com/img.png')).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('_to_image_data_uri_if_local: 존재하지 않는 경로 → null', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._to_image_data_uri_if_local('/no/such/file.png')).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it('build_system_prompt: channel+chat_id → Current Session 포함', async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const prompt = await builder.build_system_prompt([], undefined, { channel: 'slack', chat_id: 'C001' });
      expect(prompt).toContain('Current Session');
      expect(prompt).toContain('slack');
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});
