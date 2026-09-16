FROM mintplexlabs/anythingllm:latest

USER root
COPY keplerllm-entrypoint.sh /usr/local/bin/keplerllm-entrypoint.sh
RUN chmod 0755 /usr/local/bin/keplerllm-entrypoint.sh

USER anythingllm
ENTRYPOINT ["/bin/bash", "/usr/local/bin/keplerllm-entrypoint.sh"]
