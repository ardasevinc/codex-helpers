set dotenv-load := false

default:
    @just --list

lint:
    bun run lint

lint-ts:
    bun run lint:ts

lint-go:
    bun run lint:go

typecheck:
    bun run typecheck

test:
    bun run test

test-ts:
    bun run test:ts

test-go:
    bun run test:go

build:
    bun run build

build-go:
    bun run build:go

gate:
    bun run gate

full-gate:
    bun run full-gate
