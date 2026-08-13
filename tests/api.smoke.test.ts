import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { app } from '../src/index';

test('health exposes the API readiness state', async () => {
  const response = await request(app).get('/api/health');
  assert.ok([200, 503].includes(response.status));
  assert.ok(['ok', 'degraded'].includes(response.body.status));
});

test('enquiry inbox is protected', async () => {
  const response = await request(app).get('/api/enquiries');
  assert.equal(response.status, 401);
  assert.match(response.body.error, /authorized/i);
});

test('public enquiry validation rejects incomplete submissions', async () => {
  const response = await request(app).post('/api/enquiries').send({ email: 'not-an-enquiry' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /required/i);
});

test('uploads are protected before multipart processing', async () => {
  const response = await request(app).post('/api/upload');
  assert.equal(response.status, 401);
});

test('public CORS allows the production website origin', async () => {
  const response = await request(app).get('/api/health').set('Origin', 'https://timavelle-cuisine.vercel.app');
  assert.equal(response.headers['access-control-allow-origin'], 'https://timavelle-cuisine.vercel.app');
});
