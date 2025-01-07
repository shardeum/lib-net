# Release Process

## Pre-release Checklist
1. ✅ Binary caching setup (node-pre-gyp)
2. ✅ GitHub Actions workflow configured
3. ✅ Development/Production split implemented
4. ✅ Documentation updated

## Release Steps
1. Run tests and verify build:
   ```bash
   npm run clean
   npm install
   npm test
   ```

2. Create new release:
   - Use `npm run release` (uses np package)
   - This will:
     - Run tests
     - Bump version
     - Create git tag
     - Push to GitHub
     - Create GitHub release
     - Publish to npm

3. Monitor Actions:
   - Watch GitHub Actions workflow
   - Verify binary builds for all platforms
   - Check binary uploads to release

## Post-release Verification
1. Test clean installation
2. Verify binary downloads
3. Test development setup 