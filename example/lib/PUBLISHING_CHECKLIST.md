# NPM Publishing Checklist

Before publishing `three-cluster-lights` to NPM, complete these steps:

## Pre-Publishing Tasks

### 1. Update Package Metadata

Edit `lib/package.json`:

- [ ] Set `version` (follow [semver](https://semver.org/))
- [ ] Add `author` information
- [ ] Set `repository.url` (e.g., `https://github.com/username/three-cluster-lights.git`)
- [ ] Set `bugs.url` (e.g., `https://github.com/username/three-cluster-lights/issues`)
- [ ] Set `homepage` (e.g., `https://github.com/username/three-cluster-lights#readme`)
- [ ] Review `license` (currently MIT)
- [ ] Review `keywords` for discoverability

### 2. Build WASM Modules

Ensure all WebAssembly binaries are up-to-date:

```bash
cd lib/
npm run build:all
```

This creates:
- `wasm/cluster-lights.wasm` (standard)
- `wasm/cluster-lights-simd.wasm` (SIMD-optimized)
- `wasm/cluster-lights-asm.js` (JavaScript fallback)

**Note:** The `prepublishOnly` hook does this automatically, but it's good to verify beforehand.

### 3. Test the Package Locally

Create a test package:

```bash
cd lib/
npm pack
```

This creates a `.tgz` file. Test it in another project:

```bash
cd /path/to/test-project
npm install /path/to/lib/three-cluster-lights-1.0.0.tgz
```

Verify:
- [ ] All files are included
- [ ] Imports work correctly
- [ ] TypeScript definitions work
- [ ] WASM modules load properly
- [ ] No build errors

### 4. Verify Files to Publish

Check what will be published:

```bash
cd lib/
npm pack --dry-run
```

Should include:
- `index.js` and `index.d.ts`
- `core/` directory
- `performance/` directory
- `utils/` directory
- `visual/` directory
- `wasm/` directory (with .wasm and .c files)
- `README.md`
- `package.json`

Should **not** include:
- `.DS_Store` files
- `node_modules/`
- `.git` files
- Development-only files

### 5. Documentation Review

- [ ] README.md is complete and accurate
- [ ] API documentation is up-to-date
- [ ] Code examples work
- [ ] Build instructions are clear
- [ ] Migration guides are accurate

### 6. Quality Checks

- [ ] No linting errors: Check your IDE
- [ ] TypeScript definitions are complete
- [ ] All exports are documented
- [ ] Breaking changes are documented (if any)

## Publishing Steps

### 1. Login to NPM

```bash
npm login
```

### 2. Publish (Dry Run)

Test the publish process without actually publishing:

```bash
cd lib/
npm publish --dry-run
```

Review the output carefully.

### 3. Publish to NPM

```bash
cd lib/
npm publish
```

For scoped packages:

```bash
npm publish --access public
```

### 4. Verify on NPM

Check your package on npmjs.com:
- Package page loads correctly
- README displays properly
- Files are listed correctly
- Download works

### 5. Test Installation

In a new project:

```bash
npm install three-cluster-lights
```

Verify it works:

```javascript
import { ClusterLightingSystem, loadWasm } from 'three-cluster-lights';
// ... test your imports
```

## Post-Publishing Tasks

### 1. Tag the Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 2. Create GitHub Release

- Go to your repository's Releases page
- Create a new release from the tag
- Add release notes documenting changes
- Attach any relevant files

### 3. Update Documentation

- [ ] Update main README with installation instructions
- [ ] Add changelog entry
- [ ] Update examples if API changed

### 4. Announce

Consider announcing on:
- Twitter/X
- Three.js forums/Discord
- Your blog/website
- Reddit (r/threejs, r/webgl)

## Version Management

Follow semantic versioning (semver):

- **MAJOR** (1.0.0 → 2.0.0) - Breaking changes
- **MINOR** (1.0.0 → 1.1.0) - New features, backward compatible
- **PATCH** (1.0.0 → 1.0.1) - Bug fixes, backward compatible

### Updating Versions

```bash
cd lib/

# Patch version (1.0.0 → 1.0.1)
npm version patch

# Minor version (1.0.0 → 1.1.0)
npm version minor

# Major version (1.0.0 → 2.0.0)
npm version major
```

This automatically:
- Updates `package.json`
- Creates a git commit
- Creates a git tag

Then publish:

```bash
npm publish
git push && git push --tags
```

## Troubleshooting

### "Package name already taken"

Choose a different name or use a scoped package:

```json
{
  "name": "@yourusername/three-cluster-lights"
}
```

### "Authentication required"

Run `npm login` and enter your credentials.

### "Files missing from package"

Check:
- `.npmignore` isn't excluding needed files
- `files` array in `package.json` includes all necessary paths

### "WASM files not loading"

Ensure:
- WASM files are in the `files` array
- Exports map includes WASM paths
- Build scripts ran successfully

## Security

### Audit Dependencies

```bash
cd lib/
npm audit
```

Fix any vulnerabilities before publishing.

### Two-Factor Authentication

Enable 2FA on your NPM account for security:

```bash
npm profile enable-2fa
```

## Rollback

If something goes wrong:

### Unpublish (within 72 hours)

```bash
npm unpublish three-cluster-lights@1.0.0
```

**Warning:** Can only unpublish within 72 hours, and it can't be re-published later.

### Deprecate

Better than unpublishing:

```bash
npm deprecate three-cluster-lights@1.0.0 "This version has critical issues. Please use 1.0.1+"
```

Then publish a fixed version.

## Continuous Integration

Consider setting up CI/CD (GitHub Actions example):

```yaml
name: Publish to NPM

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
          registry-url: 'https://registry.npmjs.org'
      - run: cd lib && npm ci
      - run: cd lib && npm run build:all
      - run: cd lib && npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

**Ready to publish?** Start with a test publish using `npm pack` and verify everything works in a test project first!

