# TASK-065 package artifact smoke

This local-only check exercises pnpm tarball creation, clean npm installation and execution of a consumer bundle built from the installed tarball. It uses the dependency-free `@pocketdb/protocol@0.1.0` package to verify the artifact mechanics. That package remains private, exports workspace TypeScript source, and is not a release-ready SDK package. The check does not publish to a registry.

Run from any working directory:

```sh
bash artifacts/task-065-package-release/run.sh
```

The script records pnpm's dry-run manifest, package file list, SHA-512, installation output, consumer build output and consumer runtime result beside this README. The temporary install is removed when the script exits. `pocketdb-protocol-0.1.0.tgz` is the exact locally tested artifact.

Before a public release, the candidate must be built with executable JavaScript and declarations, use released dependency versions instead of `workspace:*`, pass CI and compatibility checks, and receive explicit approval in the protected npm release environment. The repository currently has no publishing workflow or publishing credentials.
