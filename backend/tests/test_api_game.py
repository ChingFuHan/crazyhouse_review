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
