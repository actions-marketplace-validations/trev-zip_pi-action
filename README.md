# pi-action

[![check](https://trev.zip/llc/pi-action/actions/workflows/check.yaml/badge.svg?branch=main&logo=forgejo&logoColor=%23bac2de&label=check&labelColor=%23313244)](https://trev.zip/llc/pi-action/actions?workflow=check.yaml)
[![vulnerable](https://trev.zip/llc/pi-action/actions/workflows/vulnerable.yaml/badge.svg?branch=main&logo=forgejo&logoColor=%23bac2de&label=vulnerable&labelColor=%23313244)](https://trev.zip/llc/pi-action/actions?workflow=vulnerable.yaml)
[![nixpkgs](https://img.shields.io/endpoint?url=https%3A%2F%2Fnix-shield.trev.zip%2Fbadge%3Furl%3Dhttps%253A%252F%252Ftrev.zip%252Fllc%252Fpi-action%252Fraw%252Fbranch%252Fmain%252Fflake.lock%26input%3Dnixpkgs&logoColor=%23bac2de&labelColor=%23313244&color=%235277C3)](https://nixos.org/)
[![node](https://img.shields.io/badge/dynamic/json?url=https://trev.zip/llc/pi-action/raw/branch/main/package.json&query=%24.engines.node&logo=nodedotjs&logoColor=%23bac2de&label=version&labelColor=%23313244&color=%23339933)](https://nodejs.org/en/about/previous-releases)

github/gitea/forgejo action for running the pi harness

## using

### npm

```sh
NPM_CONFIG_REGISTRY=https://trev.zip/api/packages/llc/npm/ \
    npx pi-action
```

### docker

```sh
docker run trev.zip/llc/pi-action:latest
```

### nix

```sh
nix run git+https://trev.zip/llc/pi-action.git
```

### action

```yaml
- uses: https://trev.zip/llc/pi-action@main
```

### download

https://trev.zip/llc/pi-action/releases

## contributing

see [CONTRIBUTING.md](CONTRIBUTING.md) for requirements and getting started
