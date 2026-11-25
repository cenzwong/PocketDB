const encode = (fields) => new TextEncoder().encode(JSON.stringify(fields));
const randomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const algorithm = { name: "ECDSA", hash: "SHA-256" };

export async function identity() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
}

export async function keyId(publicKey) {
  const raw = await crypto.subtle.exportKey("spki", publicKey);
  return Buffer.from(await crypto.subtle.digest("SHA-256", raw)).toString("base64url");
}

function transcript(scope, context, challenge) {
  return [1, scope.id, scope.instance, scope.role, scope.hostId, scope.expiresAt,
    context.hostFingerprint, context.clientFingerprint, challenge.nonce, challenge.clientId];
}

async function capabilityKey(secret) {
  return crypto.subtle.importKey("raw", Buffer.from(secret, "base64url"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export class JoinHost {
  #challenges = new Map();
  #sessions = new Map();
  #revoked = false;
  #secret;
  #keys;

  constructor(keys, scope, secret) {
    this.#keys = keys;
    this.scope = Object.freeze({ ...scope });
    this.#secret = secret;
  }

  static async create(instance, role, expiresAt) {
    const keys = await identity();
    const scope = { id: randomId(), instance, role, expiresAt, hostId: await keyId(keys.publicKey) };
    return new JoinHost(keys, scope, randomId());
  }

  invitation() {
    return { scope: this.scope, secret: this.#secret };
  }

  #check(now) {
    if (this.#revoked) throw new Error("revoked");
    if (now >= this.scope.expiresAt) throw new Error("expired");
  }

  async challenge(connection, clientKey, now) {
    this.#check(now);
    const challenge = { nonce: randomId(), clientId: await keyId(clientKey) };
    const context = connection.context;
    const fields = transcript(this.scope, context, challenge);
    this.#challenges.set(connection.id, { challenge, clientKey, expiresAt: now + 10_000, fields });
    return {
      ...challenge,
      hostKey: this.#keys.publicKey,
      signature: await crypto.subtle.sign(algorithm, this.#keys.privateKey, encode(["host", ...fields])),
    };
  }

  async join(connection, proof, now) {
    const pending = this.#challenges.get(connection.id);
    this.#challenges.delete(connection.id);
    this.#check(now);
    if (!pending || now >= pending.expiresAt || pending.challenge.nonce !== proof.nonce) {
      throw new Error("invalid challenge");
    }
    const fields = transcript(this.scope, connection.context, pending.challenge);
    if (JSON.stringify(fields) !== JSON.stringify(pending.fields)) throw new Error("invalid channel binding");
    if (!await crypto.subtle.verify(algorithm, pending.clientKey, proof.identity, encode(["client", ...fields]))) {
      throw new Error("invalid identity");
    }
    if (!await crypto.subtle.verify("HMAC", await capabilityKey(this.#secret), proof.capability, encode(["capability", ...fields]))) {
      throw new Error("invalid capability");
    }
    this.#check(now);
    const id = randomId();
    this.#sessions.set(id, { connection, details: { instance: this.scope.instance, role: this.scope.role } });
    return id;
  }

  authorize(connection, sessionId, now) {
    this.#check(now);
    const session = this.#sessions.get(sessionId);
    if (session?.connection !== connection) throw new Error("invalid session binding");
    return session.details;
  }

  revoke() {
    this.#revoked = true;
    this.#challenges.clear();
    this.#sessions.clear();
  }
}

export async function respond(invite, connection, challenge, keys) {
  const { scope, secret } = invite;
  if (await keyId(challenge.hostKey) !== scope.hostId ||
      await keyId(keys.publicKey) !== challenge.clientId) throw new Error("invalid identity");
  const fields = transcript(scope, connection.context, challenge);
  if (!await crypto.subtle.verify(algorithm, challenge.hostKey, challenge.signature, encode(["host", ...fields]))) {
    throw new Error("invalid host proof");
  }
  return {
    nonce: challenge.nonce,
    identity: await crypto.subtle.sign(algorithm, keys.privateKey, encode(["client", ...fields])),
    capability: await crypto.subtle.sign("HMAC", await capabilityKey(secret), encode(["capability", ...fields])),
  };
}
