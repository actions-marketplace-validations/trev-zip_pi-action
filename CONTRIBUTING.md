# contributing

## requirements

- [nix](https://nixos.org/)

## getting started

```sh
nix develop
```

with [direnv](https://direnv.net/):

```sh
ln -s .envrc.project .envrc
direnv allow
```

install dependencies:

```sh
npm install
```

### run

```sh
nix run
```

with [npm](https://docs.npmjs.com/):

```sh
npm run dev
```

### format

```sh
nix fmt
```

with [oxfmt](https://oxc.rs/):

```sh
oxfmt --write .
```

### check

```sh
nix flake check
```

with [npm](https://docs.npmjs.com/) and [oxlint](https://oxc.rs/):

```sh
npm test
oxlint --deny-warnings
```

### build

```sh
nix build
```

with [npm](https://docs.npmjs.com/):

```sh
npm run build
```

### release

with [bumper](https://trev.zip/llc/bumper):

```sh
bumper
```

releases are automatically created for [significant](https://www.conventionalcommits.org/en/v1.0.0/#summary) changes
