from qdrant_client import QdrantClient

def delete_all_data():
    # Adjust host and port as needed
    client = QdrantClient(host="localhost", port=6333)
    
    collections_response = client.get_collections()
    for collection in collections_response.collections:
        print(f"Deleting collection: {collection.name}")
        client.delete_collection(collection_name=collection.name)
    
    print("All collections have been deleted.")

if __name__ == "__main__":
    delete_all_data()
