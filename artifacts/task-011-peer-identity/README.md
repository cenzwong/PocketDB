# Peer identity and capability spike

The fixture uses WebCrypto P-256 identities and an HMAC-SHA-256 proof of a random 256-bit capability. The invitation pins a host public-key digest and carries an instance, role and expiry. The host signs a challenge that covers the invitation scope, both channel fingerprints, a single-use nonce and the client key identifier. The client validates the pinned host and channel before returning its signature and capability proof. The host binds the authorized session to the connection and rejects use after expiry or revocation.

## Reproduce

From this directory, run:

```sh
node verify.mjs
```

Node v25.8.1 on macOS arm64 accepted an authorized join and rejected a replay, reuse on another connection, changed channel binding, substituted host key, invalid client signature, wrong capability, expired join and session, and revoked join and session. The [result](results.json) and [driver](verify.mjs) record the checks. The fixture uses injected channel contexts to test the transcript and authorization logic. Browser extraction and wire serialization of those contexts remain unverified.

## Threat model and trust

| Threat | Candidate handling and residual risk |
| --- | --- |
| Untrusted signalling substitutes a peer | Pin the host key from a trusted invitation and bind both signatures to fingerprints from the actual local transport. Signalling can still delay, suppress or correlate connection attempts. Validate fingerprint extraction across runtimes before shipping. |
| Invitation leaks | A holder can join before expiry unless invitations are also pre-bound to a client key. Keep secrets out of query strings, signalling and logs. Use short expiry and support revocation. Erase a browser URL fragment after import and avoid persistent secret storage by default. |
| Client impersonation or replay | Require proof of the client private key and a fresh, single-use challenge. An accountless key proves possession. Human identity or prior identity needs a trusted key exchange or enrolment. |
| Session token copied or revoked | Bind execution to the live channel and its instance/role. Invalidate sessions at revocation and reauthenticate after reconnect. Production limits are needed for challenge allocation, session state and authentication attempts. |
| Host key loss or compromised origin | Replace exposed keys and invitations. Resolve key rotation, storage and recovery before release. Origin XSS could act with the page's credentials and remains outside the fixture. |

WebRTC's transport encryption and signalling trust boundary are described in [RFC 8827](https://datatracker.ietf.org/doc/rfc8827/). The fixture treats local fingerprint observations and the invitation delivery channel as trusted inputs. It does not authenticate a real browser connection, harden production state management, or establish safe read-only SQL.

## Recommendation and impact

Carry mutual proof of possession, host-key pinning, scoped capabilities, a single-use challenge and connection-bound sessions into ADR-008 review. Validate browser and Node transport bindings, interoperability, bounded state and credential handling in the implementation and security acceptance tickets. No application architecture or estimate change is implied by this fixture.
