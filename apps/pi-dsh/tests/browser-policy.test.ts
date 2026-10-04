import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserUrl } from '../browser-policy.ts'

test('browser destinations allow websites and independent dev servers but reject privileged schemes and GUI aliases', () => {
  const application = 'http://127.0.0.1:12345'
  assert.equal(browserUrl('example.com', application), 'https://example.com/')
  assert.equal(browserUrl('localhost:3000/path', application), 'http://localhost:3000/path')
  assert.equal(browserUrl('http://127.0.0.1:3000', application), 'http://127.0.0.1:3000/')
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'http://name:password@example.com', application, 'http://localhost:12345', 'http://127.1:12345', 'http://[::1]:12345', '']) assert.throws(() => browserUrl(value, application))
})
