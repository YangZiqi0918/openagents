"""Create the local signing key once without printing or replacing it."""

import os
from pathlib import Path
import secrets


def main():
    directory = Path(__file__).resolve().parent.parent / "secrets"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / "local-session.key"
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if not path.read_text(encoding="ascii").strip():
            raise SystemExit("The existing signing key is empty; repair it before starting.")
        print("Using existing local signing key.")
        return
    with os.fdopen(descriptor, "w", encoding="ascii") as output:
        output.write(secrets.token_urlsafe(48) + "\n")
    print("Created persistent local signing key.")


if __name__ == "__main__":
    main()
