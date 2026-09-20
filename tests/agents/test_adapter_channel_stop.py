"""Channel-scoped stop controls must not interrupt another task's agent run."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from openagents.adapters.aider import AiderAdapter
from openagents.adapters.amp import AmpAdapter
from openagents.adapters.claude import ClaudeAdapter
from openagents.adapters.goose import GooseAdapter


ADAPTERS = (ClaudeAdapter, AmpAdapter, AiderAdapter, GooseAdapter, "kimi")


def make_adapter(adapter_type, tmp_path, monkeypatch):
    if adapter_type == "kimi":
        pytest.importorskip("aiohttp")
        from openagents.adapters.kimi import KimiAdapter

        adapter_type = KimiAdapter
    monkeypatch.setenv("HOME", str(tmp_path))
    adapter = adapter_type(
        workspace_id="workspace",
        channel_name="general",
        token="token",
        agent_name="agent",
        working_dir=str(tmp_path),
    )
    adapter._stop_process = AsyncMock()
    adapter.client.send_message = AsyncMock()
    adapter._send_status = AsyncMock()
    adapter._send_response = AsyncMock()
    first, second = object(), object()
    adapter._channel_processes.update({"task:one": first, "task:two": second})
    adapter._channel_queues.update({"task:one": [{"id": "a"}], "task:two": [{"id": "b"}]})
    return adapter, first, second


@pytest.mark.parametrize("adapter_type", ADAPTERS)
def test_stop_only_interrupts_requested_channel(adapter_type, tmp_path, monkeypatch):
    adapter, first, second = make_adapter(adapter_type, tmp_path, monkeypatch)

    asyncio.run(adapter._on_control_action("stop", {"channel": "task:one"}))

    adapter._stop_process.assert_awaited_once_with(first)
    assert adapter._channel_processes == {"task:two": second}
    assert adapter._channel_queues == {"task:two": [{"id": "b"}]}
    assert adapter._stopping_channels == {"task:one"}


@pytest.mark.parametrize("adapter_type", ADAPTERS)
def test_stop_unknown_channel_does_not_stop_other_runs(adapter_type, tmp_path, monkeypatch):
    adapter, first, second = make_adapter(adapter_type, tmp_path, monkeypatch)

    asyncio.run(adapter._on_control_action("stop", {"channel": "task:missing"}))

    adapter._stop_process.assert_not_awaited()
    assert adapter._channel_processes == {"task:one": first, "task:two": second}
    assert adapter._channel_queues == {
        "task:one": [{"id": "a"}], "task:two": [{"id": "b"}],
    }


@pytest.mark.parametrize("adapter_type", ADAPTERS)
def test_stop_without_channel_still_stops_all_runs(adapter_type, tmp_path, monkeypatch):
    adapter, first, second = make_adapter(adapter_type, tmp_path, monkeypatch)

    asyncio.run(adapter._on_control_action("stop", {}))

    assert [call.args[0] for call in adapter._stop_process.await_args_list] == [
        first, second,
    ]
    assert adapter._channel_processes == {}
    assert adapter._channel_queues == {}
    assert adapter._stopping_channels == {"task:one", "task:two"}
