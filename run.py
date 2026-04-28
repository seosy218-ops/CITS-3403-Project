import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    port  = int(os.getenv('PORT', 5002))
    app.run(debug=debug, port=port)
