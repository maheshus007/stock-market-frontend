import React, { useState } from "react";

export default function BackendRestartButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  const handleRestart = async () => {
    setLoading(true);
    setResult("");
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/admin/restart`, {
        method: "POST",
        headers: {
          "x-admin-token": process.env.NEXT_PUBLIC_ADMIN_TOKEN || "devtoken123",
        },
      });
      const data = await res.json();
      if (data.ok) {
        setResult("Server is restarting...");
      } else {
        setResult(data.error || "Failed to restart server");
      }
    } catch (e: unknown) {
      const err = e as any;
      setResult("Error: " + (err?.message ?? String(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleRestart}
        disabled={loading}
        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
      >
        {loading ? "Restarting..." : "Restart Backend"}
      </button>
      {result && <div className="mt-2 text-sm">{result}</div>}
    </div>
  );
}
