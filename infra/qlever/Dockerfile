FROM adfreiburg/qlever:latest

# Copy your scripts into the image
COPY scripts/ /qlever/scripts/

# Ensure correct permissions
RUN sudo chmod +x /qlever/scripts/entrypoint.sh

ENTRYPOINT ["/bin/bash", "/qlever/scripts/entrypoint.sh"]
