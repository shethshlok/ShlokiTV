#!/usr/bin/env python3
"""Exercise real Git sync paths in disposable repositories, without production Docker."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('update-next.sh')


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], text=True,
                          capture_output=True, check=True).stdout.strip()


class ForkSyncTests(unittest.TestCase):
    def exercise(self, change):
        with tempfile.TemporaryDirectory(prefix='shlokitv-sync-test-') as temp:
            root = Path(temp)
            seed, host = root / 'seed', root / 'host'
            origin, upstream = root / 'origin.git', root / 'upstream.git'
            seed.mkdir()
            git(seed, 'init', '-b', 'main')
            git(seed, 'config', 'user.name', 'Sync test')
            git(seed, 'config', 'user.email', 'sync@example.invalid')
            (seed / 'scripts').mkdir()
            shutil.copyfile(SCRIPT, seed / 'scripts/update-next.sh')
            gate = seed / 'scripts/check-release.sh'
            gate.write_text('#!/bin/sh\necho VALIDATION_GATE_REACHED\nexit 73\n')
            gate.chmod(0o755)
            (seed / '.gitignore').write_text('.update-next.lock\n.next-deployed-sha\n')
            (seed / 'value.txt').write_text('base\n')
            git(seed, 'add', '.')
            git(seed, 'commit', '-m', 'Base')
            git(seed, 'tag', 'v1.0.0')
            for remote in (origin, upstream):
                git(root, 'init', '--bare', str(remote))
                git(seed, 'push', str(remote), 'main', '--tags')
            git(seed, 'switch', '-c', 'shlokitv')
            (seed / 'value.txt').write_text('custom fork\n')
            git(seed, 'commit', '-am', 'Fork change')
            git(seed, 'push', str(origin), 'shlokitv')
            git(root, 'clone', '-b', 'shlokitv', str(origin), str(host))
            git(host, 'remote', 'add', 'upstream', str(upstream))
            git(host, 'config', 'user.name', 'Sync test')
            git(host, 'config', 'user.email', 'sync@example.invalid')
            deployed = git(host, 'rev-parse', 'HEAD')
            (host / '.next-deployed-sha').write_text(deployed)
            if change == 'fork':
                (seed / 'custom.txt').write_text('new custom feature\n')
                git(seed, 'add', '.')
                git(seed, 'commit', '-m', 'Custom-only update')
                git(seed, 'push', str(origin), 'shlokitv')
            else:
                git(seed, 'switch', 'main')
                path = seed / ('value.txt' if change == 'conflict' else 'upstream.txt')
                path.write_text('new upstream release\n')
                git(seed, 'add', '.')
                git(seed, 'commit', '-m', 'Upstream change')
                git(seed, 'tag', 'v1.0.1')
                git(seed, 'push', str(upstream), 'main', '--tags')
            fork_before = git(origin, 'rev-parse', 'shlokitv')
            result = subprocess.run(['bash', str(host / 'scripts/update-next.sh')],
                                    text=True, capture_output=True)
            output = result.stdout + result.stderr
            self.assertEqual(git(host, 'rev-parse', 'HEAD'), deployed)
            self.assertEqual(git(origin, 'rev-parse', 'shlokitv'), fork_before)
            self.assertEqual((host / '.next-deployed-sha').read_text(), deployed)
            if change == 'conflict':
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('conflicts with ShlokiTV', output)
                self.assertNotIn('VALIDATION_GATE_REACHED', output)
            else:
                self.assertEqual(result.returncode, 73, output)
                self.assertIn('VALIDATION_GATE_REACHED', output)
            self.assertEqual(list(root.glob('.fork-sync-build.*')), [])

    def test_upstream_conflict_preserves_fork_and_deployment(self):
        self.exercise('conflict')

    def test_clean_upstream_merge_reaches_validation_before_push(self):
        self.exercise('upstream')

    def test_custom_update_is_checked_without_a_new_upstream_release(self):
        self.exercise('fork')


if __name__ == '__main__':
    unittest.main()
