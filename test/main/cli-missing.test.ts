import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { cliMissingMessage } from '../../src/main/env/cli-missing.js';

describe('cliMissingMessage', () => {
  it('names the binary, the context clause, and where vam looked', () => {
    const message = cliMissingMessage('claude', 'vam cannot see live sessions');
    expect(message).toContain('`claude` command was not found on PATH');
    expect(message).toContain('vam cannot see live sessions');
    expect(message).toContain('/opt/homebrew/bin');
    expect(message).toContain('/usr/local/bin');
    expect(message).toContain(`${homedir()}/.local/bin`);
  });

  it('says what would fix it', () => {
    const message = cliMissingMessage('gh', 'vam cannot ask GitHub about this branch');
    expect(message).toContain('add its directory to PATH');
  });
});
