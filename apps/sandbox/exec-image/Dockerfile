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
# Runtime `pip install ...` defaults to a user install under /workspace/.local;
# the immutable preinstalled stack stays in /opt/venv.
# /tmp (second writable emptyDir) is used for Chromium profile and temp files.

FROM debian:bookworm-slim

# ── system packages ───────────────────────────────────────────────────────────
# Curated prod baseline: docs/excel/pdf/image/ocr/qr utilities are preinstalled
# in the immutable image. Runtime `pip install` remains for rare extras only;
# `apt-get` is intentionally unavailable inside session pods (read-only root FS).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    # shell + core utilities
    bash \
    coreutils \
    tar \
    ca-certificates \
    curl \
    gnupg \
    git \
    unzip \
    zip \
    # Python 3 + venv support
    python3 \
    python3-pip \
    python3-venv \
    # WeasyPrint / headless render text-layout stack
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libharfbuzz0b \
    libfontconfig1 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libffi8 \
    shared-mime-info \
    # headless X/GL helpers (matplotlib, Chromium, image tooling)
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    # image codecs
    libjpeg62-turbo \
    libpng16-16 \
    libwebp7 \
    libtiff6 \
    libopenjp2-7 \
    # Office/XML parsing helpers
    libxml2 \
    libxslt1.1 \
    # real Office import/export engine for visible DOCX/XLSX -> PDF workflow
    libreoffice-core \
    libreoffice-common \
    libreoffice-writer \
    libreoffice-calc \
    # QR / barcode (pyzbar)
    libzbar0 \
    # PDF tooling
    poppler-utils \
    ghostscript \
    # OCR (pytesseract wrappers; runtime OCR sidecars still come from API pipeline)
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-rus \
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
#
# Use --system-site-packages so Python's user site is visible from the venv.
# Runtime pip is configured below with PIP_USER=1 + PYTHONUSERBASE=/workspace/.local,
# so ordinary model commands like `pip install colorama` write to the session
# emptyDir instead of trying to modify read-only /opt/venv.
RUN python3 -m venv --system-site-packages /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY apps/sandbox/exec-image/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
  && rm /tmp/requirements.txt

# ── make the venv authoritative for LOGIN shells too ─────────────────────────
# The image ENV PATH above only survives in non-login shells and direct exec.
# A login shell (`sh -lc`, which the model's shell tool uses) sources
# /etc/profile, which on Debian hard-resets PATH and drops /opt/venv/bin — so
# `python3`/`pip`/`weasyprint` would silently resolve to the bare system
# interpreter. /etc/profile sources /etc/profile.d/*.sh AFTER setting PATH, so
# prepending here re-establishes the venv and user script path across every shell
# invocation mode.
RUN printf '%s\n' 'export PATH="/workspace/.npm-global/bin:/workspace/.local/bin:/opt/venv/bin:$PATH"' > /etc/profile.d/10-venv.sh \
  && chmod 0644 /etc/profile.d/10-venv.sh

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
ENV PYTHONUSERBASE="/workspace/.local"
ENV PIP_USER="1"
ENV PATH="/workspace/.npm-global/bin:/workspace/.local/bin:/opt/venv/bin:$PATH"
# npm global installs write to the session-scoped workspace emptyDir instead of
# the read-only root FS — mirrors the Python PIP_USER=1 pattern above.
ENV NPM_CONFIG_PREFIX="/workspace/.npm-global"

# Keep regenerable tool caches OUT of the persisted /workspace snapshot by
# pointing them at the ephemeral /tmp emptyDir. /workspace is tar'd back to GCS
# after each job; caches (matplotlib fontlist, fontconfig, pip) must not pollute
# the user's workspace nor bloat the snapshot.
ENV XDG_CACHE_HOME="/tmp/.cache"
ENV MPLCONFIGDIR="/tmp/.matplotlib"

USER sandbox

# ── self-checks: fail the build loudly if anything is missing ─────────────────
# The login-shell check guards the /etc/profile.d/10-venv.sh fix: if a future
# change ever lets a login shell resolve `python3` to the bare system
# interpreter again, this import fails and the build breaks loudly.
RUN rg --version \
  && fd --version \
  && git --version \
  && tesseract --version \
  && pdftotext -v \
  && gs --version \
  && python3 -c "import pandas, numpy, matplotlib, seaborn, openpyxl, xlsxwriter, docx, weasyprint, pdfplumber, pypdf, reportlab, PIL, pyzbar, qrcode, pytesseract, bs4, lxml, jinja2, dateutil, yaml, requests; print('python stack ok')" \
  && python3 -c "import site; assert site.ENABLE_USER_SITE; assert site.getuserbase() == '/workspace/.local'; print('python user-site writable target ok')" \
  && /bin/sh -lc 'python3 -c "import weasyprint, pandas, pyzbar, pytesseract; print(\"login-shell python stack ok\")"' \
  && /bin/sh -lc 'python3 -c "import site; assert site.ENABLE_USER_SITE and site.getuserbase() == \"/workspace/.local\"; print(\"login-shell python user-site ok\")"' \
  && soffice --version \
  && node --version \
  && npm --version \
  && bash --version \
  && bash -c '[[ "$(echo {a,b,c})" = "a b c" ]] && echo bash_brace_ok' \
  && bash -c 'set -o pipefail; true | true && echo bash_pipefail_ok' \
  && (chromium --version || chromium-browser --version)

# The exec pod overrides CMD with sleep infinity; this is a safe fallback.
CMD ["/bin/sh"]
