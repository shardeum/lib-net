# Commit Instructions

Please make the following commits in order:

1. First commit - Setup node-pre-gyp:
```bash
git add package.json
git commit -m "build: add node-pre-gyp setup for binary distribution"
```

2. Second commit - Add GitHub Actions workflow:
```bash
git add .github/workflows/publish-binaries.yml
git commit -m "ci: configure binary distribution workflow"
```

3. Third commit - Update documentation:
```bash
git add README.md
git commit -m "docs: update installation instructions for binary distribution"
```

## Next Steps After Commits

1. Create a new GitHub release to trigger the binary build workflow
2. Monitor the GitHub Actions workflow to ensure binaries are built successfully
3. Test installation on a clean system to verify binary distribution

## Development Tips

- During development, you can use `npm install --ignore-scripts` to skip binary builds
- Use `npm run build-rust` when you need to rebuild the Rust code
- The binary builds will happen automatically on new releases 