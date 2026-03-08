import os
from unittest.mock import patch

import relog._git as git_mod


class TestInferGitProject:
    def setup_method(self):
        git_mod._resolved = False
        git_mod._cached_project = None
        git_mod._cached_branch = None

    def test_env_var_overrides(self):
        with patch.dict(os.environ, {"RELOG_PROJECT": "my-project"}):
            assert git_mod.infer_git_project() == "my-project"

    def test_git_fallback(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RELOG_PROJECT", None)
            result = git_mod.infer_git_project()
            # We're in a git repo, so should get something
            assert result is not None
            assert isinstance(result, str)

    def test_caching(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RELOG_PROJECT", None)
            os.environ.pop("RELOG_BRANCH", None)
            r1 = git_mod.infer_git_project()
            r2 = git_mod.infer_git_project()
            assert r1 == r2


class TestInferGitBranch:
    def setup_method(self):
        git_mod._resolved = False
        git_mod._cached_project = None
        git_mod._cached_branch = None

    def test_env_var_overrides(self):
        with patch.dict(os.environ, {"RELOG_BRANCH": "feature-x"}):
            assert git_mod.infer_git_branch() == "feature-x"

    def test_git_fallback(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RELOG_BRANCH", None)
            result = git_mod.infer_git_branch()
            assert result is not None
            assert isinstance(result, str)
