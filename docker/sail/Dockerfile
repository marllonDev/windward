FROM python:3.12-slim
RUN pip install --no-cache-dir "pysail==0.7.3"
EXPOSE 50051 32010
CMD ["sail", "spark", "server", "--ip", "0.0.0.0", "--port", "50051"]
