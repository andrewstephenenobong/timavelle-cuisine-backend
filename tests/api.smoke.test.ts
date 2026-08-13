import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { app } from '../src/index';

test('health exposes the API readiness state', async () => {
  const response = await request(app).get('/api/health');
  assert.ok([200, 503].includes(response.status));
  assert.ok(['ok', 'degraded'].includes(response.body.status));
  assert.ok(['ready', 'connecting', 'unavailable'].includes(response.body.database));
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(typeof response.body.checkedAt, 'string');
  assert.equal(typeof response.body.uptimeSeconds, 'number');
});

test('enquiry inbox is protected', async () => {
  const response = await request(app).get('/api/enquiries');
  assert.equal(response.status, 401);
  assert.match(response.body.error, /authorized/i);
});

test('enquiry deletion is protected', async () => {
  const response = await request(app).delete('/api/enquiries/507f1f77bcf86cd799439011');
  assert.equal(response.status, 401);
  assert.match(response.body.error, /authorized/i);
});

test('enquiry archive and restore are protected', async () => {
  const archiveResponse = await request(app).post('/api/enquiries/507f1f77bcf86cd799439011/archive');
  assert.equal(archiveResponse.status, 401);
  assert.match(archiveResponse.body.error, /authorized/i);

  const restoreResponse = await request(app).post('/api/enquiries/507f1f77bcf86cd799439011/restore');
  assert.equal(restoreResponse.status, 401);
  assert.match(restoreResponse.body.error, /authorized/i);
});

test('bulk enquiry actions are protected', async () => {
  const response = await request(app)
    .post('/api/enquiries/bulk-action')
    .send({ action: 'archive', ids: ['507f1f77bcf86cd799439011'] });
  assert.equal(response.status, 401);
  assert.match(response.body.error, /authorized/i);
});

test('forgot password returns a generic anti-enumeration response', async () => {
  const response = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-admin@example.com' });
  assert.equal(response.status, 202);
  assert.match(response.body.message, /If an admin account exists/i);
});

test('reset password rejects invalid token formats', async () => {
  const response = await request(app).post('/api/auth/reset-password').send({ token: 'invalid-token', newPassword: 'new-password-123' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /invalid or has expired/i);
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
