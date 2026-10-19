"""Completion contract shared by measurement and offline evidence validation."""
def validate_stream(completed_at, sampled_seconds):
    if completed_at is None:
        raise ValueError("stream did not finish 1200 updates and drain within 180 seconds")
    if completed_at > 180:
        raise ValueError("stream completion exceeded the 180-second deadline")
    recovery = sampled_seconds - completed_at
    if recovery < 30:
        raise ValueError(f"incomplete recovery: {recovery:.3f}s observed, 30s required")
    return recovery
