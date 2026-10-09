# Contribute to Evaluchess

Help improve gameplay, analysis, training or documentation. Reproduce problems locally and describe what your change makes possible.

## Report a problem

Open a [bug report](https://github.com/ozanedge/evaluchess/issues/new?template=bug_report.yml) with the steps you took, the expected result and what happened. Include your browser, device and game mode. A screenshot or exported game helps reproduce board and review problems.

For a proposed improvement, open a [feature request](https://github.com/ozanedge/evaluchess/issues/new?template=feature_request.yml) explaining the player’s goal and the current obstacle.

## Prepare a change

Read the [developer guide](docs/DEVELOPMENT.md), create a branch in your fork or checkout, and keep the change focused. Update the player or developer guide when behavior or setup changes.

For application changes, run the repository checks:

```sh
npm run build
npm run lint
npm test
```

Run the relevant [integration checks](docs/DEVELOPMENT.md#integration-tests) for online play, storage, engine workers or browser interactions. Their setup uses DynamoDB Local and isolated browser servers.

## Open a pull request

Describe the problem, the resulting behavior and the checks you ran. Include screenshots for interface changes and reproduction steps for gameplay fixes. Say which checks you could not run.

For documentation changes, verify commands, relative links and the current behavior described. Avoid changing production data or infrastructure to verify a documentation edit.

## Find the right starting point

The [architecture guide](docs/ARCHITECTURE.md) explains game authority and storage. The [player guide](docs/PLAYER-GUIDE.md) documents existing behavior. The [chess-computer guide](chesscomputers/README.md) covers the optional opponent worker.
