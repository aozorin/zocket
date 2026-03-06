# Git + npm + Python Release Guide

## 1) Initialize git project

```bash
git init
git add .
git commit -m "feat: zocket initial release"
git branch -M main
git remote add origin git@github.com:your-org/zocket.git
git push -u origin main
```

## 2) Pre-release checks

```bash
bash scripts/release-check.sh
```

## 3) Publish Python package (PyPI)

```bash
python3 -m pip install --upgrade build twine
python3 -m build
twine upload dist/*
```

## 4) Publish npm package

Update metadata in `package.json`:
- `name`
- `repository.url`
- `homepage`
- `bugs.url`

Then:
```bash
npm login
npm publish --access public
```

## 5) Tag release

```bash
git tag -a v1.0.0 -m "zocket v1.0.0"
git push origin v1.0.0
```

## 6) Optional GitHub Release artifacts

Upload:
- Python wheels/sdist from `dist/`
- npm package tarball from `npm pack`
