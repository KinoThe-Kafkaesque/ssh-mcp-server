import { existsSync } from 'fs';
import os from 'os';
import { join, resolve } from 'path';
import { open, type Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import type { Credential } from './types.js';

export async function initDb() {
    const dbPath = join(os.homedir(), 'ssh.db');
    console.error(`Initializing database at: ${dbPath}`);
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      username TEXT NOT NULL,
      privateKeyPath TEXT NOT NULL
    )
  `);

    return db;
}

export function validatePrivateKeyPath(path: string): string {
    console.error('DEBUG: Validating key path input:', path);
    if (typeof path !== 'string') {
        throw new Error('validatePrivateKeyPath received non-string input');
    }
    const resolvedPath = resolve(path);
    console.error('DEBUG: Resolved key path:', resolvedPath);
    if (!existsSync(resolvedPath)) {
        throw new Error(`Private key file not found at path: ${resolvedPath}`);
    }
    return resolvedPath;
}

export async function getCredentialByName(db: Database, name: string): Promise<Credential | undefined> {
    return db.get<Credential>('SELECT * FROM credentials WHERE name = ?', [name]);
}
