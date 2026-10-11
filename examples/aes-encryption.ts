/**
 * @title AES encryption and decryption
 * @difficulty intermediate
 * @tags workers, crypto
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt} MDN: SubtleCrypto.encrypt
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams} MDN: AesGcmParams
 * @check GET / -> 200 "ciphertext: 42 bytes" "decrypted: attack at dawn" "tampered: OperationError"
 *
 * AES-GCM encrypts and authenticates in one step: a ciphertext that was
 * changed fails to decrypt. Every message needs a fresh 12-byte nonce (the
 * "iv"). Put it in front of the ciphertext, so it never has to be stored
 * separately.
 */

import { script } from "./_lib/script.ts";

const IV_LENGTH = 12;

// Encrypts text and returns nonce + ciphertext + tag in one array.
async function encrypt(key: CryptoKey, text: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ciphertext), IV_LENGTH);
  return out;
}

// Splits the nonce off again and decrypts. Throws if anything was changed.
async function decrypt(key: CryptoKey, data: Uint8Array): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: data.subarray(0, IV_LENGTH) },
    key,
    data.subarray(IV_LENGTH),
  );
  return new TextDecoder().decode(plaintext);
}

export default script(async (print) => {
  // A random 256-bit key. In production, import a key from a secret with
  // crypto.subtle.importKey("raw", ...) instead.
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  ) as CryptoKey;

  // 12-byte nonce + 14-byte message + 16-byte authentication tag = 42 bytes.
  const ciphertext = await encrypt(key, "attack at dawn");
  print(`ciphertext: ${ciphertext.length} bytes`);
  print("decrypted:", await decrypt(key, ciphertext));

  // Flip one bit of the tag: authentication fails.
  const tampered = ciphertext.slice();
  tampered[tampered.length - 1]! ^= 1;
  try {
    await decrypt(key, tampered);
    print("tampered: decrypted?!");
  } catch (error) {
    print("tampered:", error instanceof Error ? error.name : String(error));
  }
});
