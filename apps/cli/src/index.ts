#!/usr/bin/env node
import { RAIBITSERVERClient } from '@raibitserver/api-client';

const apiUrl = process.env.RAIBITSERVER_API_URL || 'http://localhost:3000/api';
const client = new RAIBITSERVERClient({ baseUrl: apiUrl });

console.log(`RAIBITSERVER CLI configured for ${client.baseUrl}`);
