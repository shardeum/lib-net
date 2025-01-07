# Phase 3 Commit Instructions

Make the following commit:

```bash
git add package.json README.md
git commit -m "build: separate development and production dependencies"
```

## Verification Steps

1. Test production installation:
```bash
# In a new directory
npm install @shardus/net
```

2. Test development setup:
```bash
# In the project directory
npm run dev-setup
npm run build
npm test
```

3. Verify that the binary download works:
```bash
# Clear npm cache
npm cache clean --force
# Install in a new directory
npm install @shardus/net
```

## Note
Make sure to create a new release after these changes to trigger the binary builds. 