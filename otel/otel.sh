#!/bin/bash
#
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#  Better Stack install script for OpenTelemetry Collector
#  Generated on 2024-03-30: https://logs.betterstack.com/install/otelcol
#
#
#  Thanks for checking if the script is safe!
#  You should indeed never run random commands copied from the internet in your terminal.
#  https://xkcd.com/1654/
#
#
#  We're hiring! Software is our way of making the world a tiny bit better.
#  Build tools for the makers of tomorrow. https://betterstack.com
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#


# Check dependencies
command -v tar &> /dev/null || { echo "Please install 'tar' and rerun this script"; exit 1; }

# Determine the OS
OS=""
ARCH="$(uname -m)"
URL_FILTER=""

case "$(uname -s)" in
    Darwin)
        OS="macos"
        [ "$ARCH" = "arm64" ] && URL_FILTER="darwin_arm64.tar.gz" || URL_FILTER="darwin_amd64.tar.gz"
        ;;
    Linux)
        EXT="deb"
        if [ -f /etc/redhat-release ]; then
            OS="redhat"
            EXT="rpm"
        elif [ -f /etc/lsb-release ]; then
            OS="ubuntu"
        elif [ -f /etc/debian_version ]; then
            OS="ubuntu"
        fi

        case "$ARCH" in
            x86_64)
                URL_FILTER="linux_amd64.${EXT}"
                ;;
            armv6l|armv7l)
                URL_FILTER="linux_armv7.${EXT}"
                ;;
            armv8|aarch64)
                URL_FILTER="linux_arm64.${EXT}"
                ;;
            *)
                echo "Unsupported architecture: $ARCH. Exiting."
                exit 1
                ;;
        esac
        ;;
esac

if [ -z "$OS" ]; then
    echo "Your OS is not identified as macOS, Ubuntu/Debian, or RedHat. Exiting."
    exit 1
fi

# Get the latest release URL for otelcol based on OS and release name
LATEST_RELEASE_URL=$(curl -sSL https://api.github.com/repos/open-telemetry/opentelemetry-collector-releases/releases/latest | grep "browser_download_url.*otelcol_.*$URL_FILTER" | awk '{ print $2 }' | sed 's/"//g' | sed 's/,//')

if [ -z "$LATEST_RELEASE_URL" ]; then
    echo "Failed to retrieve the latest release URL. Exiting."
    exit 1
fi

# Create a directory for the download
mkdir -p /tmp/otelcol_download

# Change to the directory
cd /tmp/otelcol_download

# Download the latest release
curl -sSLO $LATEST_RELEASE_URL

# Install
if [[ "$OS" == "ubuntu" ]]; then
  dpkg -i otelcol_*_$URL_FILTER
elif [[ "$OS" == "redhat" ]]; then
  rpm -ivh otelcol_*_$URL_FILTER
else
  # macOS
  # Extract the downloaded tarball
  tar -xzf otelcol_*_$URL_FILTER

  # Determine the install location and move the binary
  INSTALL_PATH="/usr/local/bin/"

  mv otelcol $INSTALL_PATH
fi

if [[ "$OS" == "ubuntu" || "$OS" == "redhat" ]]; then
    # Enable the service
    systemctl enable otelcol
fi

# Cleanup the temporary directory
rm -rf /tmp/otelcol_download

echo -e "[1m[32mSuccessfully installed OpenTelemetry Collector. Please, continue with the step-by-step guide in the Better Stack documentation.[0m"
