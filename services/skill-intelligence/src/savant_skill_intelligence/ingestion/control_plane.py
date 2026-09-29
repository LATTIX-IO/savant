"""HTTP client for the Savant control plane's internal worker API.

The worker authenticates with the platform worker token and holds no database
credentials. Each claim returns a leased, tenant-scoped, sanitized bundle.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class ControlPlaneError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"{status}: {message}")
        self.status = status


@dataclass
class ControlPlaneClient:
    base_url: str
    worker_token: str
    timeout_seconds: float = 60.0

    def _post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        request = urllib.request.Request(
            f"{self.base_url.rstrip('/')}{path}",
            data=json.dumps(body or {}).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.worker_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310 - configured URL
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8")).get("error", {}).get("message", error.reason)
            except Exception:  # noqa: BLE001
                detail = str(error.reason)
            raise ControlPlaneError(error.code, str(detail)) from error
        return payload.get("data")

    def claim(self) -> dict[str, Any] | None:
        return self._post("/api/internal/optimization-jobs/claim")

    def submit(self, job_id: str, result: dict[str, Any]) -> dict[str, Any]:
        return self._post(f"/api/internal/optimization-jobs/{job_id}/result", result)

    def sweep(self, organization_id: str | None = None) -> Any:
        return self._post("/api/internal/skill-intelligence/sweep", {"organizationId": organization_id} if organization_id else {})
