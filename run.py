from app import create_app

# Instantiate the Flask application using the app factory.
app = create_app()

if __name__ == "__main__":
    # Run the local development server with debug tools enabled.
    app.run(debug=True)
