"""Optional client-network allowlist (ALLOWED_CLIENT_NETWORKS), enforced for every request.

The direct peer address is checked; forwarding headers are ignored because no proxy is used.
"""

from __future__ import annotations

import ipaddress

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


def parse_networks(raw: str) -> list[IPNetwork]:
    """'127.0.0.0/8, 192.168.0.0/24' -> networks; raises ValueError on a malformed entry."""
    return [ipaddress.ip_network(part.strip(), strict=False) for part in raw.split(",") if part.strip()]


def client_allowed(host: str, networks: list[IPNetwork]) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return any(address in network for network in networks)


class ClientNetworkAllowlist:
    def __init__(self, app: ASGIApp, networks: list[IPNetwork]) -> None:
        self.app = app
        self.networks = networks

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            client = scope.get("client")
            if not client_allowed(client[0] if client else "", self.networks):
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                response = JSONResponse(
                    {"detail": {"error": "forbidden", "message": "此服務只開放給允許的網路（ALLOWED_CLIENT_NETWORKS）"}},
                    status_code=403,
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
