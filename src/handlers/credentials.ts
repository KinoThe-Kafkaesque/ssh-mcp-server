import type { Database } from 'sqlite';
import { validatePrivateKeyPath } from '../db.js';

export async function handleAddCredential(args: unknown, db: Database) {
    const { name, host, username, privateKeyPath } = args as {
        name: string;
        host: string;
        username: string;
        privateKeyPath: string;
    };

    try {
        const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);

        await db.run(
            'INSERT INTO credentials (name, host, username, privateKeyPath) VALUES (?, ?, ?, ?)',
            [name, host, username, validatedKeyPath],
        );

        return {
            content: [{
                type: 'text',
                text: `Credential ${name} added successfully`,
            }],
        };
    } catch (error: unknown) {
        return {
            content: [{
                type: 'text',
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
        };
    }
}

export async function handleListCredentials(db: Database) {
    const credentials = await db.all('SELECT * FROM credentials');
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(credentials, null, 2),
        }],
    };
}

export async function handleRemoveCredential(args: unknown, db: Database) {
    const { name } = args as { name: string };
    await db.run('DELETE FROM credentials WHERE name = ?', [name]);
    return {
        content: [{
            type: 'text',
            text: `Credential ${name} removed successfully`,
        }],
    };
}
