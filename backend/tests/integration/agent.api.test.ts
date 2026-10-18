import { jest } from '@jest/globals';
import request from 'supertest';
import { getTestApp, getCandidateToken } from '../helpers/test-app.helper.js';
import { User } from '../../src/modules/auth/models/user.model.js';
import { mockCandidateUser } from '../mocks/mock-data.js';

/**
 * Integration tests for POST /api/v1/agent/chat.
 * The Python Strands agent is fully mocked via a stubbed global `fetch`;
 * no network, Bedrock, Decider or MongoDB access is required.
 */
describe('Agent Chat Proxy Integration Tests', () => {
  const app = getTestApp();

  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  let fetchHandler: (url: string, init: RequestInit) => Promise<unknown>;

  const fakeResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });

  const mockAgentPayload = {
    reply: 'I analyzed your resume and it matches the backend role.',
    decision: {
      pattern: 'tool_selection',
      selected_tool: 'analyze_resume',
      confidence: 0.92,
      latency_ms: 34.5,
      raw_choice: 'analyze_resume',
      used_fallback: false,
      intervention_events: [],
    },
  };

  beforeEach(() => {
    fetchCalls.length = 0;
    fetchHandler = async () => fakeResponse(200, mockAgentPayload);

    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init: RequestInit
    ) => {
      fetchCalls.push({ url, init });
      return fetchHandler(url, init);
    };

    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue({
        ...mockCandidateUser,
        isPasswordChangedAfterTokenIssued: () => false,
      }),
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
  });

  it('should reject unauthenticated requests without contacting the agent', async () => {
    const res = await request(app)
      .post('/api/v1/agent/chat')
      .send({ message: 'Hello agent' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('should return 422 for an invalid payload without contacting the agent', async () => {
    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: '   ' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('should forward the JWT header and validated message to the Python agent', async () => {
    const token = getCandidateToken();

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: '  Analyze my resume  ' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBe(mockAgentPayload.reply);
    expect(res.body.data.decision.selected_tool).toBe('analyze_resume');
    // Decision metadata must survive the proxy unchanged for the UI to display it.
    expect(res.body.data.decision.pattern).toBe('tool_selection');
    expect(res.body.data.decision.confidence).toBe(0.92);
    expect(res.body.data.decision.latency_ms).toBe(34.5);
    expect(res.body.data.decision.used_fallback).toBe(false);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('http://127.0.0.1:8080/v1/chat');
    expect(fetchCalls[0].init.method).toBe('POST');

    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);

    expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({
      message: 'Analyze my resume',
    });
  });

  it('should never forward client-supplied user identity to the agent', async () => {
    await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Hello', userId: 'attacker-supplied-id', role: 'admin' });

    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({
      message: 'Hello',
    });
  });

  it('should map a 503 from the agent to a 503 response', async () => {
    fetchHandler = async () =>
      fakeResponse(503, { detail: 'strands-decider server not reachable' });

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('should return 503 when the agent service is unreachable', async () => {
    fetchHandler = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    };

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('should return 504 when the agent request times out', async () => {
    fetchHandler = async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    };

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(504);
    expect(res.body.success).toBe(false);
  });

  it('should return 502 for unexpected agent server errors', async () => {
    fetchHandler = async () => fakeResponse(500, { detail: 'Agent request failed.' });

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    // Internal upstream 5xx detail must never reach the client.
    expect(res.body.message).not.toContain('Agent request failed');
  });

  it('should propagate an agent 400 with its safe validation detail', async () => {
    fetchHandler = async () =>
      fakeResponse(400, { detail: 'message exceeds maximum length (8000 characters).' });

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('exceeds maximum length');
  });

  it('should map an agent 401 to a 401 response', async () => {
    fetchHandler = async () =>
      fakeResponse(401, { detail: 'Invalid or expired access token.' });

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should map an agent 429 to a 429 response', async () => {
    fetchHandler = async () => fakeResponse(429, { detail: 'Too many requests.' });

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });

  it('should return 502 when the agent returns a malformed payload', async () => {
    fetchHandler = async () => fakeResponse(200, { decision: {} });

    const res = await request(app)
      .post('/api/v1/agent/chat')
      .set('Authorization', `Bearer ${getCandidateToken()}`)
      .send({ message: 'Analyze my resume' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});
