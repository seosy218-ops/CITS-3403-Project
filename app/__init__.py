from flask import Flask, redirect, render_template, request, url_for


def create_app() -> Flask:
    # Initialize the Flask application and register all route handlers.
    app = Flask(__name__)

    # Redirect the root path to the sign-in flow as the default entry point.
    @app.route("/")
    def index():
        return redirect(url_for("login"))

    # Render the login page and forward to Discover after a demo form submit.
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            return redirect(url_for("feed"))
        return render_template("auth/login.html")

    # Render the registration page and route back to sign-in on submit.
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            return redirect(url_for("login"))
        return render_template("auth/register.html")

    # Display the discover view with sample producer cards.
    @app.route("/discover", methods=["GET"])
    def discover():
        return render_template("main/discover.html")

    # Display the listen feed layout (visual baseline only).
    @app.route("/feed", methods=["GET"])
    def feed():
        return render_template("main/feed.html")

    # Return the configured Flask app instance to the caller.
    return app
