"""External command-line helper for Mission Control runtime updates."""

import argparse
import contextlib
import sys
from pathlib import Path

from runtime_update import (
    _transaction_paths,
    apply_transaction,
    pending_update_status,
    recover_pending_update,
)


def build_parser():
    parser = argparse.ArgumentParser(description="Mission Control runtime updater")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status")
    status.add_argument("root", type=Path)
    status.add_argument("--transaction-token")

    prepare = subparsers.add_parser("prepare-launch")
    prepare.add_argument("root", type=Path)

    apply = subparsers.add_parser("apply")
    apply.add_argument("root", type=Path)
    apply.add_argument("transaction_id")
    apply.add_argument("--launcher-pid", type=int, required=True)
    return parser


def main(argv=None):
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "status":
            result = pending_update_status(arguments.root, arguments.transaction_token)
            print(result["message"])
            return 4 if result["pending"] else 0
        if arguments.command == "prepare-launch":
            result = recover_pending_update(arguments.root)
            print(result["message"])
            return 3 if result["status"] == "busy" else 0
        paths = _transaction_paths(arguments.root, arguments.transaction_id)
        paths["log"].parent.mkdir(parents=True, exist_ok=True)
        with paths["log"].open("a", encoding="utf-8", buffering=1) as log:
            with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                print("Starting Mission Control runtime update helper.")
                try:
                    apply_transaction(
                        arguments.root,
                        arguments.transaction_id,
                        launcher_pid=arguments.launcher_pid,
                    )
                except Exception as exc:
                    print(f"Mission Control update error: {exc}", file=sys.stderr)
                    return 1
                print("Mission Control runtime update completed.")
        return 0
    except Exception as exc:
        print(f"Mission Control update error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
