/**
 * Standalone Gemini API connectivity test.
 * Run with:  node server/test-gemini.js
 * Reads GEMINI_API_KEY and GEMINI_MODEL from .env
 * Never prints the API key.
 */
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY || '';
const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

console.log('=== SaarthiFlow — Gemini API Connectivity Test ===\n');
console.log(`Model          : ${modelName}`);
console.log(`Key present    : ${Boolean(apiKey)}`);
console.log(`Key length     : ${apiKey.length}`);
console.log(`Key prefix     : ${apiKey.substring(0, 6)}…`);
console.log(`AIza format    : ${apiKey.startsWith('AIza')}`);
console.log('');

if (!apiKey || apiKey === 'your_gemini_api_key_here') {
  console.error('❌  GEMINI_API_KEY is not set in .env');
  process.exit(1);
}

if (!apiKey.startsWith('AIza')) {
  console.warn('⚠️   Key does NOT start with "AIza" — this is not a standard Google AI Studio key.');
  console.warn('    Gemini REST API keys issued from https://aistudio.google.com always begin with "AIza".');
  console.warn('    The current value looks like an OAuth2 access token or service-account credential,');
  console.warn('    which are NOT supported by the @google/generative-ai SDK used here.');
  console.warn('    Please replace GEMINI_API_KEY with a fresh key from https://aistudio.google.com/apikey\n');
}

try {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.1 }
  });

  console.log('Sending test prompt to Gemini…');
  const result = await model.generateContent('Reply with exactly one word: Hello');
  const text = result.response.text().trim();
  console.log(`\n✅  Gemini responded successfully: "${text}"`);
  console.log(`    Model used: ${modelName}`);
} catch (err) {
  console.error(`\n❌  Gemini API call failed`);
  console.error(`    Error name    : ${err.name}`);
  console.error(`    Error message : ${err.message}`);
  if (err.status)        console.error(`    HTTP status   : ${err.status}`);
  if (err.statusText)    console.error(`    HTTP text     : ${err.statusText}`);
  if (err.errorDetails)  console.error(`    Details       : ${JSON.stringify(err.errorDetails)}`);
  process.exit(1);
}
