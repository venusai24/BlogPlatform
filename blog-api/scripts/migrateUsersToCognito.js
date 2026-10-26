// Copy the app's users into the Cognito user pool, once.
//
//   node scripts/migrateUsersToCognito.js            dry run: counts, no passwords, nothing sent
//   node scripts/migrateUsersToCognito.js --apply    creates the users and prints username,temporaryPassword
//
// Needs MONGODB_URI, COGNITO_USER_POOL_ID and AWS credentials. Password hashes cannot be moved, so each
// user gets a random temporary password and must choose a new one at first sign-in. The CSV goes to
// stdout only: never write it to a file or a log. Hand the passwords over once, then discard them.
const crypto = require('crypto');
const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

// base64url alone could, rarely, lack a lowercase letter; the suffix guarantees the pool's policy
// (12+ characters, lower, upper, number).
function generateTemporaryPassword() {
    return crypto.randomBytes(12).toString('base64url') + 'aA1!';
}

function buildCreateUserCommand(username, temporaryPassword, userPoolId) {
    return new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        TemporaryPassword: temporaryPassword,
        MessageAction: 'SUPPRESS' // no email: the users have none on record
    });
}

async function migrate({ users, userPoolId, apply, write = console.log, client }) {
    const result = { created: 0, skipped: 0, wouldCreate: 0 };

    if (!apply) {
        result.wouldCreate = users.length;
        write(`Dry run: ${users.length} users would be created in ${userPoolId}. Re-run with --apply.`);
        return result;
    }

    const cognito = client || new CognitoIdentityProviderClient({});
    write('username,temporaryPassword');
    for (const { username } of users) {
        const temporaryPassword = generateTemporaryPassword();
        try {
            await cognito.send(buildCreateUserCommand(username, temporaryPassword, userPoolId));
        } catch (err) {
            if (err.name === 'UsernameExistsException') {
                result.skipped++;
                continue;
            }
            throw err;
        }
        result.created++;
        write(`${username},${temporaryPassword}`);
    }
    return result;
}

async function main() {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID is required');
    const apply = process.argv.includes('--apply');

    const mongoose = require('mongoose');
    const User = require('../model/User');
    await mongoose.connect(process.env.MONGODB_URI);
    try {
        const users = await User.find({}, { username: 1, _id: 0 }).lean();
        const result = await migrate({ users, userPoolId, apply });
        console.error(JSON.stringify(result)); // stderr, so stdout stays a clean CSV
    } finally {
        await mongoose.connection.close();
    }
}

module.exports = { buildCreateUserCommand, generateTemporaryPassword, migrate };

if (require.main === module) {
    main().then(() => process.exit(0)).catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}
