# Sandbox execution image — the toolchain the model runs inside the gVisor exec pod.
#
# Security constraints this image satisfies (enforced by exec pod securityContext):
#   runAsNonRoot: true | runAsUser: 1000 | runAsGroup: 1000
#   readOnlyRootFilesystem: true — only /workspace and /tmp are writable (emptyDir mounts)
#   capabilities.drop: [ALL]
#   seccompProfile: RuntimeDefault
#
# Chromium note (consumed by Slice 5 in-sandbox PDF render):
#   Always invoke as:
#     chromium --no-sandbox --headless=new --user-data-dir=/tmp/chromium-profile ...
#   --no-sandbox: gVisor is the isolation boundary; Chromium's own sandboxing
#                 conflicts with gVisor's seccomp/syscall filter.
#   --user-data-dir=/tmp/chromium-profile: keeps cache/profile in writable /tmp,
#                 not in the read-only root FS.
#
# HOME=/workspace: Python (matplotlib cache), pip user installs, and other home-dir
# writers go to /workspace which is the session-scoped writable emptyDir.
# /tmp (second writable emptyDir) is used for Chromium profile and temp files.

FROM debian:bookworm-slim

# ── system packages ───────────────────────────────────────────────────────────
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    # shell + core utilities
    bash \
    coreutils \
    tar \
    ca-certificates \
    curl \
    gnupg \
    # Python 3 + venv support
    python3 \
    python3-pip \
    python3-venv \
    # WeasyPrint text-layout system libs (pango/harfbuzz/cairo stack)
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libfontconfig1 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libffi8 \
    # fast search tools: ripgrep (rg) + fd-find (fdfind → fd symlink below)
    ripgrep \
    fd-find \
    # headless Chromium (apt resolves all transitive system deps)
    chromium \
    # fonts: Cyrillic (primary: Russian) + CJK + broad Unicode coverage
    fonts-dejavu \
    fonts-liberation \
    fonts-noto \
    fonts-noto-cjk \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

# ── fd symlink: Debian installs the binary as fdfind ─────────────────────────
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd

# ── Node.js 22 LTS (NodeSource) ───────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# ── Python packages in an isolated venv at /opt/venv ─────────────────────────
# The venv lives in the immutable image layer (built as root); it is readable
# at runtime under readOnlyRootFilesystem: true. pip installs go through the
# builder network (CI), not the runtime egress proxy.
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY apps/sandbox/exec-image/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
  && rm /tmp/requirements.txt

# ── refresh font cache into the image layer ───────────────────────────────────
RUN fc-cache -f -v

# ── non-root user uid=1000 / gid=1000 ────────────────────────────────────────
# Matches exec pod securityContext: runAsUser: 1000, runAsGroup: 1000.
RUN groupadd --gid 1000 sandbox \
  && useradd --uid 1000 --gid 1000 --no-create-home --shell /bin/bash sandbox

# /workspace is the Kubernetes emptyDir mount point (writable at runtime).
# Creating it here makes it a valid mount point and lets the USER sandbox
# self-check RUN below write to HOME without errors.
# At runtime the Kubernetes emptyDir shadows this directory; it starts empty
# and writable regardless of what is here in the image layer.
RUN mkdir -p /workspace \
  && chown sandbox:sandbox /workspace

# HOME=/workspace — the session-scoped writable emptyDir, so the model's own
# files and runtime `pip install --user` packages persist across the session.
ENV HOME="/workspace"

# Keep regenerable tool caches OUT of the persisted /workspace snapshot by
# pointing them at the ephemeral /tmp emptyDir. /workspace is tar'd back to GCS
# after each job; caches (matplotlib fontlist, fontconfig, pip) must not pollute
# the user's workspace nor bloat the snapshot.
ENV XDG_CACHE_HOME="/tmp/.cache"
ENV MPLCONFIGDIR="/tmp/.matplotlib"

USER sandbox

# ── self-checks: fail the build loudly if anything is missing ─────────────────
RUN rg --version \
  && fd --version \
  && python3 -c "import pandas, numpy, matplotlib, openpyxl, docx, weasyprint, pdfplumber, PIL; print('python stack ok')" \
  && node --version \
  && (chromium --version || chromium-browser --version)

# The exec pod overrides CMD with sleep infinity; this is a safe fallback.
CMD ["/bin/sh"]
