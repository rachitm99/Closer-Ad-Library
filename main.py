# main.py
import os
import cv2
import torch
import weaviate
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import numpy as np
import clip  # pip install git+https://github.com/openai/CLIP.git

# ---------------------------
# CONFIG
# ---------------------------
WEAVIATE_URL = "http://localhost:8080"  # adjust if needed
VIDEO_TEMP_DIR = os.path.join(os.getcwd(), "temp_videos")
os.makedirs(VIDEO_TEMP_DIR, exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_NAME = "ViT-L/14"
DEFAULT_TOP_K = 5
MAX_FRAMES_PER_VIDEO = 5  # for query videos

# ---------------------------
# INIT
# ---------------------------
print("Loading CLIP model...")
clip_model, preprocess = clip.load(MODEL_NAME, device=DEVICE)
print("CLIP loaded.")

client = weaviate.Client(url=WEAVIATE_URL)
app = FastAPI()

# CORS configuration: allow frontend dev origin(s) by default
allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if allowed_origins_env:
    origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
else:
    origins = ["http://localhost:3000"]

print("CORS allowed origins:", origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------
# UTILITIES
# ---------------------------
def create_schema():
    """Create VideoSegment schema if not exists (Weaviate v4 compatible)."""
    try:
        existing_schema = client.schema.get()
        classes = existing_schema.get("classes", [])
        if any(c["class"] == "VideoSegment" for c in classes):
            print("Schema already exists.")
            return

        print("Schema not found. Creating...")
        schema_class = {
            "class": "VideoSegment",
            "description": "Video segment with CLIP embedding and metadata",
            "vectorizer": "none",
            "vectorIndexType": "hnsw",
            "vectorIndexConfig": {"efConstruction": 128, "maxConnections": 64},
            "properties": [
                {"name": "video_id", "dataType": ["text"]},
                {"name": "segment_index", "dataType": ["int"]},
                {"name": "path", "dataType": ["text"]},
                {"name": "start_time", "dataType": ["number"]},
                {"name": "end_time", "dataType": ["number"]},
                {"name": "extra", "dataType": ["text"]},
            ]
        }
        client.schema.create_class(schema_class)
        print("Schema created.")
    except Exception as e:
        print("Failed to create schema:", e)


def extract_frames(video_path, fps=1):
    """
    Extract frames from a video at a fixed fps interval.
    """
    vidcap = cv2.VideoCapture(video_path)
    frames = []
    count = 0
    video_fps = vidcap.get(cv2.CAP_PROP_FPS)
    step = max(int(video_fps // fps), 1)
    success, image = vidcap.read()
    while success:
        if count % step == 0:
            img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            frames.append(Image.fromarray(img_rgb))
        success, image = vidcap.read()
        count += 1
    vidcap.release()
    return frames

def embed_frames(frames):
    """Compute CLIP embeddings for list of PIL frames."""
    embeddings = []
    with torch.no_grad():
        for img in frames:
            img_tensor = preprocess(img).unsqueeze(0).to(DEVICE)
            emb = clip_model.encode_image(img_tensor)
            emb = emb / emb.norm(dim=-1, keepdim=True)
            embeddings.append(emb.cpu().numpy()[0])
    return embeddings

def store_segments(video_id, frames, embeddings):
    """Store each frame as a VideoSegment in Weaviate."""
    for idx, emb in enumerate(embeddings):
        client.data_object.create(
            data_object={
                "video_id": str(video_id),
                "segment_index": idx,
                "path": f"video_{video_id}_frame_{idx}",
                "start_time": idx,  # placeholder
                "end_time": idx + 1,  # placeholder
                "extra": "",
            },
            class_name="VideoSegment",
            vector=emb.tolist()
        )

# ---------------------------
# ROUTES
# ---------------------------
@app.post("/add_video/")
async def add_video(file: UploadFile = File(...), video_id: str = Form(...)):
    temp_path = os.path.join(VIDEO_TEMP_DIR, file.filename)
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    frames = extract_frames(temp_path)
    if not frames:
        os.remove(temp_path)
        return JSONResponse({"error": "No frames extracted"}, status_code=400)

    embeddings = embed_frames(frames)
    store_segments(video_id, frames, embeddings)

    os.remove(temp_path)
    return {"message": f"{len(frames)} frames uploaded for video {video_id}"}

# @app.post("/query_video/")
# async def query_video(file: UploadFile = File(...), top_k: int = Form(5)):
    # temp_path = os.path.join(VIDEO_TEMP_DIR, file.filename)
    # with open(temp_path, "wb") as f:
    #     f.write(await file.read())

    # frames = extract_frames(temp_path, fps=1)
    # if not frames:
    #     return JSONResponse({"error": "No frames extracted"}, status_code=400)

    # embeddings = embed_frames(frames)
    # # query_vector = embeddings[0].tolist()
    # query_vector = np.mean(embeddings, axis=0).tolist()


    # result = (
    #     client.query.get("VideoSegment", ["video_id", "segment_index", "path"])
    #     .with_near_vector({"vector": query_vector})
    #     .with_additional(["distance"])  # important
    #     .with_limit(top_k)
    #     .do()
    # )

    # os.remove(temp_path)

    # hits = []
    # for h in result.get("data", {}).get("Get", {}).get("VideoSegment", []):
    #     hits.append({
    #         "video_id": h["video_id"],
    #         "segment_index": h["segment_index"],
    #         "path": h["path"],
    #         "similarity": 1 - h["_additional"]["distance"]
    #     })

    # return {"results": hits}

@app.post("/query_video/")
async def query_video(file: UploadFile = File(...), top_k: int = Form(5)):
    import collections
    temp_path = os.path.join(VIDEO_TEMP_DIR, file.filename)
    with open(temp_path, "wb") as f:
        f.write(await file.read())
    
    # Extract & embed all frames
    frames = extract_frames(temp_path)  # fps can be adjusted if needed
    if not frames:
        return JSONResponse({"error": "No frames extracted"}, status_code=400)
    
    embeddings = embed_frames(frames)

    video_scores = collections.defaultdict(list)

    # Query Weaviate for each frame
    for emb in embeddings:
        query_vector = emb.tolist()
        try:
            result = client.query.get("VideoSegment", ["video_id", "segment_index", "path"]) \
                .with_near_vector({"vector": query_vector}) \
                .with_additional(["distance"]) \
                .with_limit(top_k) \
                .do()
        except Exception as e:
            continue

        segments = result.get("data", {}).get("Get", {}).get("VideoSegment", [])
        for seg in segments:
            # Compute similarity from distance (Weaviate stores distance for nearest neighbors)
            if "_additional" in seg and "distance" in seg["_additional"]:
                sim = 1 - seg["_additional"]["distance"]
            else:
                sim = 0
            video_scores[seg["video_id"]].append(sim)

    # Aggregate scores per video
    aggregated_results = []
    for vid, sims in video_scores.items():
        aggregated_results.append({
            "video_id": vid,
            "avg_similarity": float(np.mean(sims)),
            "max_similarity": float(np.max(sims)),
            "matches_count": len(sims)
        })

    # Sort by highest avg_similarity
    aggregated_results.sort(key=lambda x: x["avg_similarity"], reverse=True)

    os.remove(temp_path)
    return {"results": aggregated_results[:top_k]}


# ---------------------------
# STARTUP
# ---------------------------
create_schema()
