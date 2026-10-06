import pytest
from fastapi.testclient import TestClient

from app.chess_core import STARTING_FEN, position_id
from app.main import create_app

client = TestClient(create_app())


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_position_and_move_round_trip():
    root = client.post("/api/position", json={"moves": []}).json()
    assert root["fen"] == STARTING_FEN and root["ply"] == 0
    child = client.post(
        "/api/move", json={"moves": [], "position_id": root["position_id"], "move": "e2e4"}
    ).json()
    assert child["last_move"]["from"] == "e2"
    assert child["moves"] == ["e2e4"]
    assert child["position_id"] == position_id(STARTING_FEN, ["e2e4"])


def test_position_id_mismatch_is_rejected():
    response = client.post("/api/move", json={"moves": ["e2e4"], "position_id": "deadbeefdeadbeef", "move": "e7e5"})
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "position_mismatch"


def test_illegal_move_returns_reason():
    response = client.post("/api/move", json={"moves": [], "move": "N@e4"})
    assert response.status_code == 422
    assert response.json()["detail"] == {"error": "illegal_move", "move": "N@e4", "message": "白方的 pocket 裡沒有馬"}


def test_invalid_line_returns_422():
    response = client.post("/api/position", json={"moves": ["e2e5"]})
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "invalid_line"


def test_pgn_endpoint():
    response = client.post("/api/pgn", json={"pgn": "1. e4 d5 2. exd5 Qxd5 3. P@e4 *"})
    assert response.status_code == 200
    body = response.json()
    assert body["variant_assumed"] is True
    assert body["root"]["children"][0]["state"]["last_move"]["san"] == "e4"
    bad = client.post("/api/pgn", json={"pgn": '[Variant "Atomic"]\n\n1. e4 *'})
    assert bad.status_code == 422 and bad.json()["detail"]["error"] == "invalid_pgn"


def test_built_frontend_is_served_after_api_routes(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>Crazyhouse Review</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    served = TestClient(create_app(frontend_dist=tmp_path))
    assert "Crazyhouse Review" in served.get("/").text
    assert served.get("/assets/app.js").status_code == 200
    assert served.get("/api/health").json() == {"status": "ok"}
    assert served.post("/api/position", json={"moves": []}).status_code == 200
    without = TestClient(create_app(frontend_dist=None))
    assert without.get("/").status_code == 404


def test_client_network_allowlist():
    from app.access import parse_networks

    lan = parse_networks("127.0.0.0/8, ::1/128, 192.168.0.0/24")
    app = create_app(frontend_dist=None, allowed_networks=lan)
    assert TestClient(app, client=("192.168.0.5", 50000)).get("/api/health").status_code == 200
    assert TestClient(app, client=("127.0.0.1", 50000)).get("/api/health").status_code == 200
    assert TestClient(app, client=("::ffff:192.168.0.9", 50000)).get("/api/health").status_code == 200
    for outsider in ("100.70.168.53", "172.17.0.2", "192.168.1.5", "testclient"):
        response = TestClient(app, client=(outsider, 50000)).post("/api/position", json={"moves": []})
        assert response.status_code == 403, outsider
        assert response.json()["detail"]["error"] == "forbidden"
    # Forwarding headers are not trusted.
    spoof = TestClient(app, client=("100.70.168.53", 50000)).get("/api/health", headers={"X-Forwarded-For": "192.168.0.5"})
    assert spoof.status_code == 403


def test_allowlist_from_environment(monkeypatch):
    monkeypatch.setenv("ALLOWED_CLIENT_NETWORKS", "192.168.0.0/24")
    assert TestClient(create_app(frontend_dist=None), client=("10.0.0.1", 1)).get("/api/health").status_code == 403
    monkeypatch.setenv("ALLOWED_CLIENT_NETWORKS", "192.168.0.0/33")
    with pytest.raises(ValueError):
        create_app(frontend_dist=None)
    monkeypatch.delenv("ALLOWED_CLIENT_NETWORKS")
    assert TestClient(create_app(frontend_dist=None), client=("10.0.0.1", 1)).get("/api/health").status_code == 200
