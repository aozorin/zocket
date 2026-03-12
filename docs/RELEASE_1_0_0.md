# Zocket v1.0.0 — Публикация в GitHub и npm

Этот файл — полностью самодостаточная инструкция для публикации Zocket v1.0.0.

## 0) Важное про токены

Никогда не вставляйте npm/GitHub токены в чат.  
Публикацию делайте локально после `npm login` и `git push`.

## 1) Что уже подготовлено в репозитории

- `package.json` настроен на репозиторий `https://github.com/aozorin/zocket`
- версию `1.0.0` уже закоммитили
- тег `v1.0.0` стоит на актуальном коммите

Проверить:

```bash
git status -sb
git log --oneline -1
git tag -n | grep v1.0.0
```

## 2) Выбор имени npm-пакета (важно)

Сейчас в `package.json` стоит:

```json
"name": "@zocket/cli"
```

Это **требует, чтобы у тебя был scope `@zocket`**.  
Если scope **НЕ** принадлежит тебе, поменяй имя на одно из:

1. `@aozorin/zocket`
2. `zocket`

### Как поменять имя

Открой `package.json` и измени поле `"name"`, затем:

```bash
git add package.json
git commit -m "chore: set npm package name"
git tag -d v1.0.0
git tag v1.0.0
```

## 3) Создание GitHub репозитория

Создай репозиторий:  
`https://github.com/aozorin/zocket`

## 4) Публикация в GitHub

Из папки проекта:

```bash
git remote add origin https://github.com/aozorin/zocket.git
git push -u origin main --tags
```

## 5) Публикация в npm

Выполни:

```bash
npm login
npm publish --access public
```

Если выбран scope (например `@aozorin/...`) — публикация должна быть публичной.

## 6) Проверка установки

После публикации:

```bash
npm i -g <PACKAGE_NAME>
zocket --help
```

Если `PACKAGE_NAME` — `@zocket/cli`, то:

```bash
npm i -g @zocket/cli
```

## 7) Мини‑чеклист перед релизом

- [ ] `package.json` name соответствует твоему npm scope
- [ ] `repository/homepage/bugs` указывают на `aozorin/zocket`
- [ ] `npm publish` прошёл без ошибок
- [ ] `git push --tags` прошёл без ошибок

## 8) Где документация по установке

После публикации пользователям нужно смотреть:

- [docs/INSTALL.md](/home/zorin/project/zocket/docs/INSTALL.md)
- [docs/CLIENTS_MCP.md](/home/zorin/project/zocket/docs/CLIENTS_MCP.md)
- [README.md](/home/zorin/project/zocket/README.md)

